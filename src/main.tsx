import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import LandingWithIntro from './components/LandingWithIntro';
import { AnalyticsInitializer } from './utils/analytics';
import './styles/index.scss';

AnalyticsInitializer();

function AppWrapper() {
    const [hasFinishedIntro, setHasFinishedIntro] = useState(false);

    return hasFinishedIntro ? <AuthWrapper /> : <LandingWithIntro onFinish={() => setHasFinishedIntro(true)} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<AppWrapper />);
