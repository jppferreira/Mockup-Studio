import { Link, useSearchParams } from 'react-router-dom';
import { LICENSE_KEY_HINTS } from '@shared/checkout';
import { PLAN_PRICES_GBP, formatGbp, planById } from '@shared/pricing';
import { DownloadButton } from '../components/DownloadButton';
import { Reveal } from '../components/Reveal';
import { SiteChrome } from '../components/SiteChrome';

export function ThanksPage() {
  const [params] = useSearchParams();
  const raw = params.get('plan');
  const planId = raw === 'pro_max' || raw === 'update_pass' || raw === 'pro' ? raw : 'pro';
  const plan = planById(planId);
  const keyHint =
    planId === 'pro_max'
      ? LICENSE_KEY_HINTS.pro_max
      : planId === 'update_pass'
        ? LICENSE_KEY_HINTS.update_pass
        : LICENSE_KEY_HINTS.pro;

  return (
    <SiteChrome>
      <main className="page">
        <header className="page-hero">
          <p className="section-kicker">Checkout</p>
          <h1>Thanks for supporting Mockup Studio.</h1>
          <p className="page-lede">
            {plan.name} is {plan.priceLabel}
            {planId === 'update_pass' ? '/year' : ' one-time'}. Your payment receipt comes from the store;
            your signed license key is emailed by Mockup Studio right after payment clears.
          </p>
        </header>

        <Reveal as="section" className="thanks-steps">
          <ol>
            <li>
              <strong>Check your inbox</strong>
              <span>Open the Mockup Studio license email (separate from the store receipt).</span>
            </li>
            <li>
              <strong>Open Mockup Studio</strong>
              <span>In the app, choose License in the left panel.</span>
            </li>
            <li>
              <strong>Activate</strong>
              <span>
                Paste a key like <code>{keyHint}</code>. Pro is {formatGbp(PLAN_PRICES_GBP.pro)}; Pro Max is{' '}
                {formatGbp(PLAN_PRICES_GBP.pro_max)}.
              </span>
            </li>
          </ol>
        </Reveal>

        <Reveal as="section" className="page-note">
          <p>
            Set your payment link’s success URL to <code>/thanks?plan=pro</code> or{' '}
            <code>/thanks?plan=pro_max</code> so buyers land here after checkout.
          </p>
        </Reveal>

        <Reveal as="section" className="page-cta">
          <DownloadButton className="btn btn-primary" fallbackHref="/#download">
            Download for Mac
          </DownloadButton>
          <Link className="btn btn-ghost" to="/pricing">
            Back to pricing
          </Link>
        </Reveal>
      </main>
    </SiteChrome>
  );
}
