import { type ComponentConfig, type Config, type CustomFieldRender, Render } from '@puckeditor/core'
import { GLOBAL_SECTION, type PuckNode } from '@spa/services/site-kit'
import { GlobalSectionField } from '../editor/global-field'
import type { SiteMeta } from '../types'
import { metaOf } from './shared'

/** Global saved sections a page uses, loaded on the server (`globalSectionsFor`) and passed as metadata. */
export type GlobalsMeta = { globals?: Record<string, PuckNode> }

const innerConfigs = new WeakMap<Config, Config>()

/** The same blocks without the page chrome (root) and without GlobalSection itself, so nothing can recurse. */
function innerConfig(config: Config): Config {
  let inner = innerConfigs.get(config)
  if (!inner) {
    const { [GLOBAL_SECTION]: _self, ...components } = config.components
    inner = {
      ...config,
      components,
      root: { render: ({ children }: { children: React.ReactNode }) => <>{children}</> },
    }
    innerConfigs.set(config, inner)
  }
  return inner
}

/**
 * Global section (PLAN §11.2): renders a tenant's saved section by reference, so editing it once updates every
 * page that shows it. The block itself only stores `sectionId`; content comes from `metadata.globals`.
 */
export function globalSectionBlock(getConfig: () => Config): ComponentConfig<{ sectionId: string }> {
  return {
    label: 'Global section',
    fields: {
      sectionId: {
        type: 'custom',
        label: 'Global section',
        render: GlobalSectionField as unknown as CustomFieldRender<string>,
      },
    },
    defaultProps: { sectionId: '' },
    render: ({ puck, sectionId }) => {
      const meta = metaOf(puck) as SiteMeta & GlobalsMeta
      const node = meta.globals?.[sectionId]
      if (!node) {
        if (!meta.editing) return null as unknown as React.ReactElement
        return (
          <div className="mx-auto my-6 max-w-6xl px-5 sm:px-8">
            <p className="rounded-xl border border-dashed border-[#a8823a] bg-[#f5eedf] px-4 py-6 text-center font-sans text-sm text-[#7a5d22]">
              This global section was deleted from the library. Remove this block or pick another section.
            </p>
          </div>
        )
      }
      return (
        <Render
          config={innerConfig(getConfig())}
          data={{ root: { props: {} }, content: [node as never] }}
          metadata={meta}
        />
      )
    },
  }
}
