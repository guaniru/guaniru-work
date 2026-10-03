# Weather Forecast App

A free, static weather app built with Vite + React.

## Features
- Search by city name
- Uses free APIs only
- No backend required
- Browser-side local cache with localStorage
- Responsive UI
- Ready for GitHub Pages or Netlify

## Tech stack
- React
- Vite
- Open-Meteo
- Nominatim

## Local development
```bash
npm install
npm run dev
```

## Production build
```bash
npm run build
```

## Deploy to GitHub Pages
This repo includes a GitHub Actions workflow for Pages deployment.

1. Push the project to GitHub.
2. Open the repository on GitHub.
3. Go to Settings > Pages.
4. Source: GitHub Actions.
5. Commit and run the workflow.

## Notes
- The app uses browser-side API calls, so there is no server cost.
- This keeps the project free to run and deploy.
