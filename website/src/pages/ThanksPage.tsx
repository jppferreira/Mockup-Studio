import { Link, useSearchParams } from 'react-router-dom';
import { PLAN_PRICES_GBP, formatGbp, planById } from '@shared/pricing';
import { DownloadButton } from '../components/DownloadButton';
import { SHOW_RELEASE_DOWNLOADS } from '../content';
import { Reveal } from '../components/Reveal';
import { SiteChrome } from '../components/SiteChrome';

export function ThanksPage() {
  const [params] = useSearchParams();
  const raw = params.get('plan');
  const planId = raw === 'pro_max' || raw === 'update_pass' || raw === 'pro' ? raw : 'pro';
  const plan = planById(planId);
  const sessionId = params.get('session_id');

  return (
    <SiteChrome>
      <main className="page">
        <header className="page-hero">
          <p className="section-kicker">Checkout</p>
          <h1>Thanks for supporting mokstudio.</h1>
          <p className="page-lede">
            {plan.name} is {plan.priceLabel}
            {planId === 'update_pass' ? '/year' : ' one-time'}. Your Stripe receipt is on the way;
            your mokstudio account unlocks automatically once payment clears.
          </p>
        </header>

        <Reveal as="section" className="thanks-steps">
          <ol>
            <li>
              <strong>Stay signed in</strong>
              <span>
                Use the same email you checked out with. Pro is {formatGbp(PLAN_PRICES_GBP.pro)}; Pro Max is{' '}
                {formatGbp(PLAN_PRICES_GBP.pro_max)}.
              </span>
            </li>
            <li>
              <strong>Open mokstudio</strong>
              <span>In the Mac app or web studio, open License / Account to confirm your plan.</span>
            </li>
            <li>
              <strong>Start creating</strong>
              <span>
                {planId === 'update_pass'
                  ? 'Your update window extends for another year from payment.'
                  : 'Commercial use, full devices, and exports are unlocked on this account.'}
              </span>
            </li>
          </ol>
        </Reveal>

        {sessionId ? (
          <Reveal as="section" className="page-note">
            <p>
              Stripe session <code>{sessionId}</code> recorded. If the plan doesn’t show yet, wait a few
              seconds and refresh License in the app.
            </p>
          </Reveal>
        ) : null}

        <Reveal as="section" className="page-cta">
          {SHOW_RELEASE_DOWNLOADS ? (
            <DownloadButton className="btn btn-primary" fallbackHref="/#download">
              Download for Mac
            </DownloadButton>
          ) : null}
          <Link className="btn btn-ghost" to="/pricing">
            Back to pricing
          </Link>
        </Reveal>
      </main>
    </SiteChrome>
  );
}
