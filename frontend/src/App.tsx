import { useEffect } from 'react';
import { usePos } from './store';
import { isSecondDisplay } from './lib/display';
import { Header } from './components/Header';
import { ToastStack } from './components/ToastStack';
import { LoginPage } from './pages/LoginPage';
import { LockPage } from './pages/LockPage';
import { ModePage } from './pages/ModePage';
import { TablePage } from './pages/TablePage';
import { OrderPage } from './pages/OrderPage';
import { PaymentPage } from './pages/PaymentPage';
import { ReceiptPage } from './pages/ReceiptPage';
import { SettingsPage } from './pages/SettingsPage';
import { SecondDisplay } from './pages/SecondDisplay';

function BootScreen() {
  return (
    <div className="boot-screen">
      <div className="boot-rings">
        <span />
        <span />
        <span />
      </div>
      <div className="brand-mark big">
        <span>W</span>
      </div>
      <div className="wordmark">WORKAPOS</div>
      <p>Menyiapkan terminal…</p>
      <div className="boot-bar"><i /></div>
    </div>
  );
}

export default function App() {
  const secondDisplay = isSecondDisplay();
  const screen = usePos((state) => state.screen);
  const user = usePos((state) => state.user);
  const boot = usePos((state) => state.boot);
  const bootError = usePos((state) => state.bootError);
  const init = usePos((state) => state.init);

  useEffect(() => {
    if (!secondDisplay) void init();
  }, [init, secondDisplay]);

  if (secondDisplay) {
    return <SecondDisplay />;
  }

  if (screen === 'boot') {
    return (
      <>
        <BootScreen />
        <ToastStack />
      </>
    );
  }

  if (screen === 'login' || (!user && screen !== 'settings')) {
    return (
      <>
        <LoginPage />
        {bootError ? <div className="boot-error-ribbon">{bootError}</div> : null}
        <ToastStack />
      </>
    );
  }

  if (screen === 'locked') {
    return (
      <>
        <LockPage />
        <ToastStack />
      </>
    );
  }

  if (screen === 'settings') {
    return (
      <>
        <SettingsPage />
        <ToastStack />
      </>
    );
  }

  return (
    <div className="app-shell">
      <Header />
      <div className="app-content">
        {screen === 'mode' ? <ModePage /> : null}
        {screen === 'table' ? <TablePage /> : null}
        {screen === 'order' ? <OrderPage /> : null}
        {screen === 'payment' ? <PaymentPage /> : null}
        {screen === 'receipt' ? <ReceiptPage /> : null}
      </div>
      <ToastStack />
      {!boot ? <div className="offline-watermark">OFFLINE</div> : null}
    </div>
  );
}
