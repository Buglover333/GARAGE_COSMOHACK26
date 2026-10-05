# Frontend

React, TypeScript, Vite, and Three.js frontend for the constellation simulator.

## Development

Start the FastAPI backend on port 8000, then run:

```bash
npm install
npm run dev
```

The application is available at `http://localhost:3000`. Vite proxies `/api`
and `/ws` to the backend.

## Production build

```bash
npm run lint
npm run build
```

FastAPI serves the generated `dist` directory at `http://localhost:8000`.

## Structure

- `src/components` — interface and Three.js scene components.
- `src/components/comparison` — configuration comparison feature.
- `src/types` — frontend domain types.
- `src/utils` — orbital mechanics and visual utilities.
- `src/data` — static comparison fixtures.
- `public` — assets copied to the production bundle.
