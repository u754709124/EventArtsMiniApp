export default defineAppConfig({
  pages: [
    "pages/index/index",
    "pages/announcement/detail",
    "pages/cases/list",
    "pages/cases/detail",
    "pages/artists/list",
    "pages/artists/detail",
    "pages/contact/index",
    "pages/category/index",
    "pages/mine/index"
  ],
  window: {
    navigationStyle: "custom",
    backgroundTextStyle: "light",
    navigationBarBackgroundColor: "#fffaf5",
    navigationBarTitleText: "喜缘主持",
    navigationBarTextStyle: "black"
  },
  tabBar: {
    color: "#7a7a7a",
    selectedColor: "#d94332",
    backgroundColor: "#ffffff",
    borderStyle: "black",
    list: [
      {
        pagePath: "pages/index/index",
        text: "首页",
        iconPath: "assets/generated/tab-home.png",
        selectedIconPath: "assets/generated/tab-home-active.png"
      },
      {
        pagePath: "pages/category/index",
        text: "分类",
        iconPath: "assets/generated/tab-category.png",
        selectedIconPath: "assets/generated/tab-category-active.png"
      },
      {
        pagePath: "pages/cases/list",
        text: "案例",
        iconPath: "assets/generated/tab-case.png",
        selectedIconPath: "assets/generated/tab-case-active.png"
      },
      {
        pagePath: "pages/mine/index",
        text: "我的",
        iconPath: "assets/generated/tab-mine.png",
        selectedIconPath: "assets/generated/tab-mine-active.png"
      }
    ]
  }
});
