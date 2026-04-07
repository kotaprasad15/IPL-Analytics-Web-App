# Hover Motion Cards (Tailwind + Framer)

## Files
- `HoverCard.motion.jsx` (reusable card)
- `HoverCardMotionDemo.jsx` (example usage)

## Install
```bash
npm install framer-motion
```

Tailwind must already be configured in your React app.

## Reusable props
- `type`: `"team"` or `"player"`
- `name`: display name
- `imageUrl`: team logo or player image
- `teamColor`: hex team color (`#d32f2f`, etc.)
- `subtitle` (optional)
- `meta` (optional)

## Example
```jsx
import HoverCardMotion from "./react/HoverCard.motion";

<HoverCardMotion
  type="team"
  name="Mumbai Indians"
  imageUrl="https://documents.iplt20.com/ipl/assets/images/teams-new-logo/MI.png"
  teamColor="#004ba0"
  subtitle="Batting SR 153.7 · Top 4 race"
/>
```
