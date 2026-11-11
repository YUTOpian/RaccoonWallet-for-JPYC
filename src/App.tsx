import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import NotificationHost from './components/NotificationHost';
import ScheduledPaymentWatcher from './components/ScheduledPaymentWatcher';

function App() {
  return (
    <>
      <RouterProvider router={router} />
      {/* 右上の通知(送金しました / 送金完了 など)。画面遷移しても消えないよう、ルーターの外に置く */}
      <NotificationHost />
      {/* 期日が来た予約送金を、起動時・復帰時・定期的に確認して知らせる(画面は持たない) */}
      <ScheduledPaymentWatcher />
    </>
  );
}

export default App;
