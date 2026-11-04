import { Link } from 'react-router-dom';
import { isCheckoutConfigured } from '@shared/checkout';
import {
  BUYER_GUIDE,
  PLANS,
  PRICING_TAGLINE,
  UPDATE_PASS,
} from '@shared/pricing';
import { CheckoutButton } from '../components/CheckoutButton';
import { DownloadButton } from '../components/DownloadButton';
import { Reveal } from '../components/Reveal';
import { SiteChrome } from '../components/SiteChrome';

export function PricingPage() {
  const matrixRows = PLANS[0].features.map((f) => f.label);
  const liveCheckout =
    isCheckoutConfigured('pro') || isCheckoutConfigured('pro_max') || isCheckoutConfigured('update_pass');

  return (
    <SiteChrome>
      <main className="page pricing-page">
        <header className="page-hero">
          <p className="section-kicker">Pricing</p>
          <h1>Buy once. Keep forever.</h1>
          <p className="page-lede">{PRICING_TAGLINE}</p>
        </header>

        <ul className="pricing-grid">
          {PLANS.map((plan, i) => (
            <Reveal
              as="li"
              key={plan.id}
              className={`pricing-card ${plan.highlighted ? 'is-highlighted' : ''}`}
              delay={i * 80}
            >
              {plan.highlighted && <span className="pricing-badge">Most popular</span>}
              <p className="pricing-name">{plan.name}</p>
              <p className="pricing-price">
                {plan.priceLabel}
                <span>{plan.billing}</span>
              </p>
              <p className="pricing-tagline">{plan.tagline}</p>
              <ul className="pricing-includes">
                {plan.includes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {plan.id === 'free' ? (
                <DownloadButton className="btn btn-ghost" fallbackHref="/#download">
                  {plan.cta}
                </DownloadButton>
              ) : (
                <CheckoutButton
                  plan={plan.id}
                  className={`btn ${plan.highlighted ? 'btn-primary' : 'btn-ghost'}`}
                />
              )}
            </Reveal>
          ))}
        </ul>

        <Reveal as="section" className="update-pass-band">
          <div>
            <p className="section-kicker">After year one</p>
            <h2>{UPDATE_PASS.name}</h2>
            <p>{UPDATE_PASS.tagline}</p>
          </div>
          <div className="update-pass-price">
            <strong>{UPDATE_PASS.priceLabel}</strong>
            <span>{UPDATE_PASS.billing}</span>
          </div>
          <div className="update-pass-actions">
            <ul className="pricing-includes">
              {UPDATE_PASS.includes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <CheckoutButton plan="update_pass" className="btn btn-ghost" />
          </div>
        </Reveal>

        <Reveal as="section" className="pricing-matrix-wrap">
          <p className="section-kicker">What you get</p>
          <h2>Compare plans side by side.</h2>
          <div className="pricing-matrix-scroll">
            <table className="pricing-matrix">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  {PLANS.map((plan) => (
                    <th key={plan.id} scope="col">
                      {plan.name}
                      <span>{plan.priceLabel}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixRows.map((label) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {PLANS.map((plan) => {
                      const cell = plan.features.find((f) => f.label === label);
                      return (
                        <td key={plan.id}>
                          {cell?.included ? (
                            <>
                              <span className="matrix-yes">Included</span>
                              {cell.note && <span className="matrix-note">{cell.note}</span>}
                            </>
                          ) : (
                            <span className="matrix-no">{cell?.note ?? '—'}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <Reveal as="section" className="buyer-guide">
          <p className="section-kicker">Who should buy what</p>
          <ul>
            {BUYER_GUIDE.map((row) => (
              <li key={row.who}>
                <span>{row.who}</span>
                <strong>{row.plan}</strong>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal as="section" className="page-note" id="checkout">
          <p>
            {liveCheckout
              ? 'Checkout opens in a secure payment window. After purchase you get a license key by email — paste it in the Mac app under License. Prices in GBP; VAT may apply at checkout.'
              : 'Payment links are not configured yet — Buy buttons email sales for now. Add VITE_CHECKOUT_PRO_URL / VITE_CHECKOUT_PRO_MAX_URL from .env.example to go live. Prices in GBP; VAT may apply at checkout.'}
          </p>
        </Reveal>

        <Reveal as="section" className="page-cta">
          <DownloadButton className="btn btn-primary" fallbackHref="/#download" />
          <CheckoutButton plan="pro" className="btn btn-ghost" />
        </Reveal>
      </main>
    </SiteChrome>
  );
}
