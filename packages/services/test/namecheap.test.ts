import { describe, expect, it, vi } from 'vitest'
import {
  checkDomains,
  getBalance,
  NamecheapError,
  namecheapConfig,
  namecheapPhone,
  platformRecords,
  registerDomain,
  registerPrices,
  setHosts,
  splitDomain,
} from '../src/integrations/namecheap'

const cfg = namecheapConfig({
  NAMECHEAP_API_USER: 'spa',
  NAMECHEAP_API_KEY: 'k',
  NAMECHEAP_CLIENT_IP: '1.2.3.4',
})!
const ok = (inner: string) =>
  `<?xml version="1.0"?><ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response"><CommandResponse>${inner}</CommandResponse></ApiResponse>`
const reply = (xml: string) =>
  vi.fn(async () => new Response(xml, { status: 200 })) as unknown as typeof fetch

describe('namecheap', () => {
  it('reads config from env and requires the whitelisted IP', () => {
    expect(namecheapConfig({ NAMECHEAP_API_USER: 'a', NAMECHEAP_API_KEY: 'b' })).toBeNull()
    expect(cfg).toMatchObject({ userName: 'spa', sandbox: false })
  })

  it('splits domains and formats phones', () => {
    expect(splitDomain('Serenity-Spa.COM')).toEqual({ sld: 'serenity-spa', tld: 'com' })
    expect(splitDomain('serenity.com.ae')).toEqual({ sld: 'serenity', tld: 'com.ae' })
    expect(() => splitDomain('www.serenity.com')).toThrow(NamecheapError)
    expect(namecheapPhone('971501234567')).toBe('+971.501234567')
  })

  it('parses availability (incl. premium) and sends auth params', async () => {
    const f = reply(
      ok(
        '<DomainCheckResult Domain="serenityspa.com" Available="false" ErrorNo="0" Description="" IsPremiumName="false" PremiumRegistrationPrice="0"/>' +
          '<DomainCheckResult Domain="serenity.spa" Available="true" ErrorNo="0" IsPremiumName="true" PremiumRegistrationPrice="120.00"/>',
      ),
    )
    const r = await checkDomains(cfg, ['serenityspa.com', 'serenity.spa'], f)
    expect(r).toEqual([
      { domain: 'serenityspa.com', available: false, premium: false, premiumPriceUsd: null, error: null },
      { domain: 'serenity.spa', available: true, premium: true, premiumPriceUsd: 120, error: null },
    ])
    const body = String((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body)
    expect(body).toContain('Command=namecheap.domains.check')
    expect(body).toContain('ClientIp=1.2.3.4')
  })

  it('keeps good results when one TLD is unsupported (.ae)', async () => {
    const f = reply(
      '<ApiResponse Status="ERROR"><Errors><Error Number="2030280">Tld for \'spamanagement.ae\' is not found</Error></Errors>' +
        '<CommandResponse><DomainCheckResult Domain="spamanagement.co" Available="true" ErrorNo="0" IsPremiumName="false"/></CommandResponse></ApiResponse>',
    )
    const r = await checkDomains(cfg, ['spamanagement.ae', 'spamanagement.co'], f)
    expect(r.find((x) => x.domain === 'spamanagement.co')?.available).toBe(true)
    expect(r.find((x) => x.domain === 'spamanagement.ae')).toMatchObject({
      available: false,
      error: "Tld for 'spamanagement.ae' is not found",
    })
  })

  it('surfaces API errors (e.g. IP not whitelisted)', async () => {
    const f = reply(
      '<ApiResponse Status="ERROR"><Errors><Error Number="1011150">Parameter RequestIP is invalid</Error></Errors></ApiResponse>',
    )
    await expect(checkDomains(cfg, ['a.com'], f)).rejects.toMatchObject({
      code: '1011150',
      message: 'Parameter RequestIP is invalid',
    })
  })

  it('reads one-year register prices', async () => {
    const f = reply(
      ok(
        '<UserGetPricingResult><ProductType Name="domains"><ProductCategory Name="register"><Product Name="com">' +
          '<Price Duration="1" DurationType="YEAR" Price="10.28" RegularPrice="13.98" YourPrice="10.28" Currency="USD"/>' +
          '<Price Duration="2" DurationType="YEAR" Price="20.00" YourPrice="20.00" Currency="USD"/>' +
          '</Product></ProductCategory></ProductType></UserGetPricingResult>',
      ),
    )
    expect(await registerPrices(cfg, ['com'], f)).toEqual({ com: 10.28 })
  })

  it('registers a domain and sets platform DNS records', async () => {
    const contact = {
      firstName: 'Aisha',
      lastName: 'Rahman',
      address1: 'Cluster D, JLT',
      city: 'Dubai',
      stateProvince: 'Dubai',
      postalCode: '00000',
      country: 'AE',
      phoneE164: '971501234567',
      email: 'owner@serenity.ae',
    }
    const create = reply(
      ok(
        '<DomainCreateResult Domain="serenityspa.com" Registered="true" ChargedAmount="10.28" DomainID="9" OrderID="7" TransactionID="5"/>',
      ),
    )
    expect(
      await registerDomain(
        cfg,
        { domain: 'serenityspa.com', years: 1, registrant: contact, admin: contact },
        create,
      ),
    ).toEqual({
      domain: 'serenityspa.com',
      chargedUsd: 10.28,
      domainId: '9',
      orderId: '7',
      transactionId: '5',
    })
    const hosts = reply(ok('<DomainDNSSetHostsResult Domain="serenityspa.com" IsSuccess="true"/>'))
    const records = platformRecords('serenityspa.com', {
      cname: '1-2-3-4.sslip.io',
      verificationToken: 'tok',
    })
    expect(await setHosts(cfg, 'serenityspa.com', records, hosts)).toBe(true)
    const body = String((hosts as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body)
    expect(body).toContain('SLD=serenityspa&TLD=com')
    expect(body).toContain('RecordType1=CNAME&Address1=1-2-3-4.sslip.io.')
    expect(decodeURIComponent(body)).toContain('Address2=https://www.serenityspa.com')
  })

  it('reads the available balance', async () => {
    const f = reply(
      ok('<UserGetBalancesResult Currency="USD" AvailableBalance="42.50" AccountBalance="50.00"/>'),
    )
    expect(await getBalance(cfg, f)).toEqual({ currency: 'USD', availableUsd: 42.5 })
  })
})
