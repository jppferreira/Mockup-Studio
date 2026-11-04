import { Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from './Landing';
import { FeaturesPage } from './pages/FeaturesPage';
import { PricingPage } from './pages/PricingPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { ThanksPage } from './pages/ThanksPage';
import { WorkflowPage } from './pages/WorkflowPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/features" element={<FeaturesPage />} />
      <Route path="/workflow" element={<WorkflowPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/thanks" element={<ThanksPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
