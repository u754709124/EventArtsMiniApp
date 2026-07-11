import type { ThemeConfig } from "antd";

export const adminTheme: ThemeConfig = {
  token: {
    colorPrimary: "#9a5a1f",
    colorInfo: "#9a5a1f",
    colorBgLayout: "#f6f3ef",
    colorBgContainer: "#fffdf9",
    colorBorder: "#eee5dc",
    colorText: "#1f1f1f",
    colorTextHeading: "#2b1d12",
    borderRadius: 8,
    borderRadiusLG: 8,
    fontSize: 14,
    boxShadowSecondary: "0 8px 24px rgb(67 38 16 / 8%)"
  },
  components: {
    Button: {
      borderRadius: 8
    },
    Card: {
      borderRadiusLG: 8,
      headerBg: "#fffdf9"
    },
    Table: {
      headerBg: "#fbf5ee",
      headerColor: "#4b3523"
    },
    Layout: {
      headerBg: "#fffdf9",
      siderBg: "#fffdf9"
    }
  }
};
