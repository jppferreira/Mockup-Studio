import { Link } from 'react-router-dom';
import { PLAN_PRICES_GBP, formatGbp } from '@shared/pricing';
import {
  EXPORT_USAGE_NOTICE,
  MODEL_LICENSING_NOTICE,
  NON_AFFILIATION_DISCLAIMER,
} from '@shared/legal';
import { DownloadButton } from '../components/DownloadButton';
import { Reveal } from '../components/Reveal';
import { SiteChrome } from '../components/SiteChrome';

const SECTIONS = [
  {
    title: 'Agreement',
    copy:
      'By downloading, installing, or using mokstudio you agree to these Terms and the proprietary LICENSE shipped with the app. If you do not agree, do not use the software.',
  },
  {
    title: 'Plans and entitlements',
    copy: `Free (${formatGbp(PLAN_PRICES_GBP.free)}) is for personal, non-commercial use with the limits shown on Pricing. Pro (${formatGbp(PLAN_PRICES_GBP.pro)} one-time) and Pro Max (${formatGbp(PLAN_PRICES_GBP.pro_max)} one-time) unlock commercial use and the paid feature set. After purchase you keep the app and the features you bought forever.`,
  },
  {
    title: 'Updates and Update Pass',
    copy: `Pro and Pro Max include about 12 months of device and feature updates from activation. After that window the app and already-unlocked features keep working. An optional Update Pass (${formatGbp(PLAN_PRICES_GBP.update_pass)}/year) extends the update window. Update Pass does not replace a Pro or Pro Max license.`,
  },
  {
    title: 'License keys (direct download)',
    copy:
      'Website and direct-download purchases are unlocked with signed license keys emailed after checkout. Keys are personal to you. Do not share, sell, or publicly post keys. Lost a key? Use /recover with the purchase email to verify ownership and receive a newly signed key.',
  },
  {
    title: 'Dual-Mac and transfer (Pro Max)',
    copy:
      'Pro Max may be activated on up to two Macs you own or control, or transferred to a new Mac with help from support (sales@mokstudio.io). This is a license policy, not device DRM. Free and Pro are single-seat unless we agree otherwise in writing.',
  },
  {
    title: 'Mac App Store (if offered later)',
    copy:
      'If mokstudio is also distributed on the Mac App Store, purchases and unlocks made through Apple are governed by Apple’s Licensed Application End User License Agreement, App Store terms, and Apple’s refund rules, in addition to these Terms for the product itself. In-app unlocks on a Mac App Store build use Apple In-App Purchase rather than external checkout.',
  },
  {
    title: 'Your content',
    copy:
      'Screenshots, project files, and exports you create remain yours. We do not claim ownership of your work. The desktop app is designed to keep project contents on your Mac.',
  },
  {
    title: 'Non-affiliation',
    copy: NON_AFFILIATION_DISCLAIMER,
  },
  {
    title: 'Third-party models and trademarks',
    copy: MODEL_LICENSING_NOTICE,
  },
  {
    title: 'Export and usage',
    copy: EXPORT_USAGE_NOTICE,
  },
  {
    title: 'Restrictions',
    copy:
      'You may not redistribute the app source or binaries, crack or forge license keys, redistribute original 3D model source files, strip model attribution, or use Free-plan output for commercial client work, ads, or store listings.',
  },
  {
    title: 'No warranty',
    copy:
      'The software is provided “as is” without warranties of any kind. To the fullest extent permitted by law we are not liable for indirect or consequential damages arising from use of the app.',
  },
  {
    title: 'Contact',
    copy: 'Questions about licensing or transfers: sales@mokstudio.io.',
  },
] as const;

export function TermsPage() {
  return (
    <SiteChrome>
      <main className="page">
        <header className="page-hero">
          <p className="section-kicker">Terms</p>
          <h1>Terms of use</h1>
          <p className="page-lede">
            Buyer-facing license terms for mokstudio — freemium Mac app, direct download today, Mac App Store optional later.
          </p>
        </header>

        <ul className="privacy-list">
          {SECTIONS.map((section, i) => (
            <Reveal as="li" key={section.title} className="privacy-row" delay={i * 40}>
              <h2>{section.title}</h2>
              <p>{section.copy}</p>
            </Reveal>
          ))}
        </ul>

        <Reveal as="section" className="page-note">
          <p>
            Also see <Link to="/privacy">Privacy</Link>, <Link to="/credits">Credits</Link>, and{' '}
            <Link to="/pricing">Pricing</Link>.
          </p>
        </Reveal>

        <Reveal as="section" className="page-cta">
          <DownloadButton className="btn btn-primary" fallbackHref="/#download">
            Download Free
          </DownloadButton>
          <Link className="btn btn-ghost" to="/pricing">
            See pricing
          </Link>
        </Reveal>
      </main>
    </SiteChrome>
  );
}
