# Article Module

## Scope

Article is a lightweight CMS content module for wedding guides and event planning posts. It reuses the shared media library and standalone detail page system:

- list/card content is stored on `articles`;
- detail content is selected through nullable `detailPageId`;
- frontend detail navigation uses `/pages/detail/index?id=<detailPageId>`;
- no article category table, slug, author, comments, likes, audit workflow, article-specific rich text body, or article-specific renderer is introduced.

## Data Model

`Article` maps to SQLite table `articles` and Prisma model `Article`.

Fields: `id`, `title`, `category`, `coverAssetId`, `summary`, `publishedAt`, `isFeatured`, `featuredSortOrder`, `sortOrder`, `status`, `detailPageId`, `createdAt`, `updatedAt`.

Foreign keys:

- `coverAssetId -> media_assets.id`
- `detailPageId -> detail_page_configs.id ON DELETE RESTRICT`

Indexes:

- `articles_detailPageId_idx`
- `articles_category_idx`
- `articles_coverAssetId_idx`
- `articles_status_sortOrder_idx`
- `articles_status_isFeatured_featuredSortOrder_idx`

SQLite bootstrap creates the table and indexes idempotently in `apps/api/src/sqlite-schema.ts`.

## Categories

Categories are plain strings on `Article.category`.

Normalization uses NFKC, trim, and continuous whitespace compression. Empty categories are rejected; max length is 30 characters. Category lists are de-duplicated case-insensitively for English by lower-casing the normalized display value as the key.

There is no `ArticleCategory` table. Admin category inputs use existing article categories as suggestions but allow typing a new valid category. Client category tabs are derived from all enabled articles, not from only the currently filtered page.

## Menu Config

`MenuType` includes `article`.

Article menu config shape:

```json
{ "category": "婚礼攻略", "pageSize": 10 }
```

`category` is optional. Admin uses a Select with a stable internal `__ALL_ARTICLES__` value for “全部文章”; that value is removed before saving, so stored config remains the public schema above. `pageSize` is clamped by shared schema to `1..50`, default `10`.

The miniapp opens article menus with `navigateTo` and query params, for example:

```text
/pages/articles/list?category=婚礼攻略&pageSize=10
```

## References

Media reference counting and deletion protection include `article.cover`, reported as `article_cover / 文章封面`.
When an article cover blocks deletion, the reference label includes concrete article titles and IDs, for example `文章封面：如何选择一位适合自己婚礼的主持人？（ID 1）`.

Detail page reference counting and deletion protection include source type `article`. Reference lists display the article title and route admin users to `/articles`.

Deleting an article does not delete its cover media or detail page.

## API And Frontend

Client:

- `GET /api/client/articles?q=&category=&page=&pageSize=`
- `GET /api/client/home` includes `featuredArticles`, max two enabled featured articles ordered by `featuredSortOrder ASC, publishedAt DESC, id ASC`.

Admin:

- `GET|POST|PUT|DELETE /api/admin/articles`
- `GET /api/admin/articles/:id`
- `GET /api/admin/articles/categories?q=&limit=` returns `{ "categories": string[] }`

Miniapp uses shared `ArticleCard` on the home featured section and article list page. Article cards are left image / right text white cards with a CSS clock icon and shared `formatArticleDisplayTime`: today `HH:mm`, yesterday `HH:mm`, otherwise `YYYY-MM-DD`.

## Seed And Assets

Seed creates at least four articles across “婚礼攻略” and “活动策划”. The first two are featured with sort order `1` and `2`; three articles reference reusable detail pages and one intentionally has `detailPageId: null`.

Seed also creates the home menu “婚礼攻略” with type `article` and config `{ "category": "婚礼攻略", "pageSize": 10 }`.

Assets are reused from existing generated horizontal images/icons and media seed registration. 复用已有资源，未使用参考图切片。

Final visual evidence paths:

- `docs/design/actual-home-h5.png`
- `docs/design/actual-articles-list-h5.png`
- `docs/design/admin-articles-list.png`
- `docs/design/admin-article-editor.png`
- `docs/design/admin-article-menu-config.png`

## Future Category Table

If article categories need independent sorting, disabled states, icons, SEO names, or editorial metadata later, introduce a dedicated `ArticleCategory` table and migrate the current normalized `Article.category` strings into stable category records. Keep the phase-one string category as the migration source, backfill article foreign keys by normalized display value, preserve the public menu config shape during the transition, and add compatibility reads until all existing article menu configs have been reconciled.
