import React from "react";
import HoverCard from "./HoverCard";
import "./hover-card.css";

const cards = [
  {
    type: "team",
    name: "Royal Challengers Bengaluru",
    subtitle: "Net RR +0.42 · 4/6 wins",
    meta: "Hover: team-color takeover + logo slide",
    imageUrl: "https://documents.iplt20.com/ipl/assets/images/teams-new-logo/RCB.png",
    teamColor: "#d32f2f",
  },
  {
    type: "team",
    name: "Mumbai Indians",
    subtitle: "Batting SR 153.7 · Top 4 race",
    meta: "Hover: deep blue with readable text",
    imageUrl: "https://documents.iplt20.com/ipl/assets/images/teams-new-logo/MI.png",
    teamColor: "#004ba0",
  },
  {
    type: "player",
    name: "Virat Kohli",
    subtitle: "Runs 421 · Avg 52.6",
    meta: "Hover: tinted card + player image slide",
    imageUrl: "https://static.iplt20.com/players/210/164.png",
    teamColor: "#d32f2f",
  },
  {
    type: "player",
    name: "Jasprit Bumrah",
    subtitle: "Wkts 16 · Econ 6.7",
    meta: "Hover: subtle tint, glass still visible",
    imageUrl: "https://static.iplt20.com/players/210/1124.png",
    teamColor: "#004ba0",
  },
];

export default function HoverCardDemo() {
  return (
    <section style={{ padding: "24px" }}>
      <h2 style={{ margin: "0 0 14px", color: "#0b3d91" }}>IPL Hover Cards</h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "14px",
        }}
      >
        {cards.map((card) => (
          <HoverCard key={`${card.type}-${card.name}`} {...card} />
        ))}
      </div>
    </section>
  );
}
