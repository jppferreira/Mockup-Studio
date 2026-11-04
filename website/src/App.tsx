import { Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from './Landing';
import { CreditsPage } from './pages/CreditsPage';
import { FeaturesPage } from './pages/FeaturesPage';
import { PricingPage } from './pages/PricingPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { RecoverPage } from './pages/RecoverPage';
import { ReleasesPage } from './pages/ReleasesPage';
import { TermsPage } from './pages/TermsPage';
import { ThanksPage } from './pages/ThanksPage';
import { WorkflowPage } from './pages/WorkflowPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/features" element={<FeaturesPage />} />
      <Route path="/workflow" element={<WorkflowPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/releases" element={<ReleasesPage />} />
      <Route path="/thanks" element={<ThanksPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/credits" element={<CreditsPage />} />
      <Route path="/recover" element={<RecoverPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
