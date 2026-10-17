'use client'
import { PencilLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Textarea } from '@/components/ui/input'
import { saveProfileLinksAction } from './profile-actions'

/** R33: edit the spa's Profile links (one per line; checked and saved by saveProfileLinksAction). */
export function ProfileLinksSheet({ slug, links }: { slug: string; links: string[] }) {
  return (
    <FormSheet
      title="Profile links"
      description="Official profiles shown to search engines (schema sameAs). Live on every page when saved."
      trigger={
        <Button variant="secondary" size="sm">
          <PencilLine /> Edit
        </Button>
      }
      action={saveProfileLinksAction.bind(null, slug)}
      submitLabel="Save links"
    >
      <Field
        label="Links"
        name="links"
        hint="Official profiles shown to search engines (schema sameAs): Google Business Profile share link, Instagram, Facebook, TikTok… https only, up to 10."
      >
        <Textarea
          id="links"
          name="links"
          rows={8}
          defaultValue={links.join('\n')}
          placeholder={'https://g.page/r/…\nhttps://www.instagram.com/yourspa/'}
          spellCheck={false}
          autoCapitalize="off"
          className="font-mono text-[13px]"
        />
      </Field>
    </FormSheet>
  )
}
