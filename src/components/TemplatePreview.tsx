import type { CompositionTemplate } from '../lib/templates';

export default function TemplatePreview({ layout }: { layout: CompositionTemplate['preview'] }) {
  return (
    <div className={`template-preview layout-${layout}`} aria-hidden>
      {layout === 'solo' && <span className="phone p1" />}
      {layout === 'pair' && (<><span className="phone p1" /><span className="phone p2" /></>)}
      {layout === 'split' && (<><span className="phone p1" /><span className="phone p2" /></>)}
      {layout === 'stack' && (<><span className="phone p1" /><span className="phone p2" /></>)}
      {layout === 'trio' && (<><span className="phone p1" /><span className="phone p2" /><span className="phone p3" /></>)}
      {layout === 'fan' && (<><span className="phone p1" /><span className="phone p2" /><span className="phone p3" /></>)}
      {layout === 'depth' && (<><span className="phone p1" /><span className="phone p2" /><span className="phone p3" /></>)}
      {layout === 'clay' && (
        <>
          <span className="prop clay sphere s1" />
          <span className="prop clay cube c1" />
          <span className="prop clay torus t1" />
          <span className="phone p1" />
        </>
      )}
      {layout === 'concrete' && (
        <>
          <span className="prop wall" />
          <span className="prop slab" />
          <span className="phone p1" />
        </>
      )}
      {layout === 'pedestal' && (
        <>
          <span className="prop pedestal" />
          <span className="prop clay torus t1" />
          <span className="phone p1" />
        </>
      )}
      {layout === 'desk' && (
        <>
          <span className="prop clay sphere s1" />
          <span className="prop clay cyl" />
          <span className="phone p1" />
          <span className="phone p2" />
        </>
      )}
      {layout === 'studio' && (
        <>
          <span className="prop studio-wall" />
          <span className="prop studio-floor" />
          <span className="phone p1" />
          <span className="prop studio-shadow" />
        </>
      )}
      {layout === 'rocks' && (
        <>
          <span className="prop rock r3" />
          <span className="prop rock r2" />
          <span className="prop rock r1" />
          <span className="phone p1" />
        </>
      )}
      {layout === 'stage' && (
        <>
          <span className="prop stage-base" />
          <span className="prop stage-deck" />
          <span className="phone p1" />
        </>
      )}
    </div>
  );
}
