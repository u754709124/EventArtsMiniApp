# EventArtsMiniApp

Phase-one WeChat mini program stack for event host and performance services.

## Requirements
- Node.js 22.12+ or compatible current LTS.
- pnpm 11.x.
- SQLite for local development.
- WeChat DevTools for final mini program inspection.

## Install
```bash
pnpm install
```

## Environment
Copy `.env.example` to `.env` and change secrets before production use.

## Database
```bash
pnpm db:push
pnpm db:seed
```

Default local admin:
- username: `admin`
- password: `admin123456`

Change the default password and `JWT_SECRET` before production.

## Development
```bash
pnpm dev:api
pnpm dev:admin
pnpm dev:h5
```

Default local URLs:
- API: `http://127.0.0.1:3001`
- Admin: `http://127.0.0.1:5173`
- Miniapp H5: `http://127.0.0.1:10086`

## Build
```bash
pnpm --filter api build
pnpm --filter admin build
pnpm --filter miniapp build:h5
pnpm build:weapp
```

Import `apps/miniapp/dist` into WeChat DevTools after `pnpm build:weapp`.

## Tests
```bash
pnpm lint
pnpm test
pnpm e2e
```

## Uploads
Local files are stored in `uploads`. Production object storage is reserved through environment-backed storage configuration; keep database `url` values stable when migrating away from local storage.

## Documentation
- Stage docs: `docs/stages`
- API docs: `docs/api/index.md`
- Design docs and screenshots: `docs/design`
