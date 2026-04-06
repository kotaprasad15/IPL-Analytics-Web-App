# IPL Analytics Web App

An interactive dashboard that breaks down Indian Premier League (IPL) team and player performances, combining historical local datasets with live official IPL feeds.

## 🏏 Features

- **Historical Analysis:** Review the last three IPL seasons using local ball-by-ball datasets. Track performance for every player who took the field.
- **Live Data Layering:** Seamlessly pulls real-time data from the official IPL online feeds (live table standings, live fixtures, batting/bowling leaders, and squad form).
- **Monte Carlo Simulator:** Features an advanced predictive model (`sim.py`) that calculates expected points, league finishes, and title odds by running tens of thousands of Monte Carlo simulations based on team ELO ratings.
- **Player Lens:** Get deep insights into individual squad contributions. Includes easy access links to ESPN Cricinfo for up-to-date player profiles.
- **Fast Client-Side Processing:** Utilizes Web Workers (`analyticsWorker.js`) to locally crunch complex and large datasets without locking up the UI.

## 🛠️ Project Structure

- `index.html`, `styles.css`, `app.js`: Core web application files.
- `liveLayer.js`: Fetches and maps live data feeds.
- `analyticsWorker.js`: Offloads heavy data crunching from the main UI thread.
- `sim.py`: Standalone Python script for calculating projected title odds using a Monte Carlo simulation.
- `/csv/` & `/json/`: Directory holding necessary historical CSV and JSON data (match info, ball-by-ball facts, player summaries).

## 🚀 Running Locally

Because the web application fetches CSV data files asynchronously, it needs to be served via a web server (simply opening `index.html` in the browser natively might lead to CORS errors).

### Prerequisites
- Any local web server of your choice.

### Using Python
1. Open a terminal in the project directory.
2. Start a simple web server:
   ```bash
   python -m http.server 8000
   ```
3. Open `http://localhost:8000` in your browser.

### Using Node.js (npx)
1. In your terminal, run:
   ```bash
   npx serve
   ```
2. Open the localhost link provided in the terminal.

## 🔮 Running the Predictor (sim.py)

The repository includes a powerful predictive python script designed to model the remainder of the tournament using Elo ratings tracking and Monte-Carlo trials.

**Requirements:** Python 3.7+

**Usage:**
```bash
# Basic usage based on available historical CSV data
python sim.py --simulations 20000

# Provide a specific schedule for a target season
python sim.py --season 2026 --schedule-csv season_2026_schedule.csv
```

## ☁️ Deployment

This is a static web application and requires no active backend (other than for the standalone `sim.py` offline script). 
It is configured to be effortlessly deployed directly to platforms like **Vercel** or **Netlify**.

**To Deploy on Vercel:**
1. Push this repository to GitHub.
2. Sign in to [Vercel](https://vercel.com/dashboard).
3. Select **Add New > Project**, and import this repository.
4. Keep the Framework Preset as `Other` and click **Deploy**.

## 📊 Data Sources
- Official IPL feeds (stats, table, squads)
- Local CSV databanks extracted from reliable cricket data providers.
