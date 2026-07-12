import Taro from "@tarojs/taro";
import { configureH5ClientLoginCodeAdapter } from "./services/api";
import "./app.scss";

function configureDevelopmentH5ClientAuth() {
  if (process.env.NODE_ENV === "production") return;
  if (Taro.getEnv?.() !== Taro.ENV_TYPE.WEB) return;
  configureH5ClientLoginCodeAdapter(() => `eventarts-h5-dev-login-${Date.now()}`);
}

configureDevelopmentH5ClientAuth();

export default function App({ children }: { children: React.ReactNode }) {
  return children;
}
