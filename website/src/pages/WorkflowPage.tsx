import { Link } from 'react-router-dom';
import { AppScreenshot } from '../components/AppScreenshot';
import { Reveal } from '../components/Reveal';
import { SiteChrome } from '../components/SiteChrome';
import { STEPS } from '../content';
import { useParallax } from '../hooks/useParallax';

export function WorkflowPage() {
  const parallax = useParallax();

  return (
    <SiteChrome>
      <main className="page">
        <header className="page-hero">
          <p className="section-kicker">Workflow</p>
          <h1>From screenshot to export.</h1>
          <p className="page-lede">
            A short path: place the UI, shape the scene, then save a still or a little motion when it feels ready.
          </p>
        </header>

        <Reveal as="section" className="page-shot">
          <AppScreenshot style={parallax.layer(0.08, 6)} />
        </Reveal>

        <ol className="workflow-detail">
          {STEPS.map((step, i) => (
            <Reveal as="li" key={step.n} className="workflow-detail-row" delay={i * 90}>
              <span className="step-n">{step.n}</span>
              <div>
                <h2>{step.title}</h2>
                <p>{step.copy}</p>
                <p className="feature-detail">{step.detail}</p>
              </div>
            </Reveal>
          ))}
        </ol>

        <Reveal as="section" className="page-cta">
          <Link className="btn btn-primary" to="/pricing">
            See pricing
          </Link>
          <Link className="btn btn-ghost" to="/#beta">
            Sign up to beta
          </Link>
        </Reveal>
      </main>
    </SiteChrome>
  );
}
