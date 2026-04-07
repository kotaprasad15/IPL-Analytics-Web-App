import React from "react";
import HoverCardMotion from "./HoverCard.motion";

const cards = [
  {
    type: "team",
    name: "Royal Challengers Bengaluru",
    subtitle: "Net RR +0.42 · 4/6 wins",
    meta: "Team hover takeover",
    imageUrl: "https://documents.iplt20.com/ipl/assets/images/teams-new-logo/RCB.png",
    teamColor: "#d32f2f",
  },
  {
    type: "team",
    name: "Chennai Super Kings",
    subtitle: "Powerplay RR 9.6",
    meta: "Adaptive text on lighter team color",
    imageUrl: "https://documents.iplt20.com/ipl/assets/images/teams-new-logo/CSK.png",
    teamColor: "#fbc02d",
  },
  {
    type: "player",
    name: "Virat Kohli",
    subtitle: "Runs 421 · Avg 52.6",
    meta: "Player hover tint",
    imageUrl: "https://static.iplt20.com/players/210/164.png",
    teamColor: "#d32f2f",
  },
  {
    type: "player",
    name: "Jasprit Bumrah",
    subtitle: "Wkts 16 · Econ 6.7",
    meta: "Slide + fade from left",
    imageUrl: "https://static.iplt20.com/players/210/1124.png",
    teamColor: "#004ba0",
  },
];

export default function HoverCardMotionDemo() {
  return (
    <section className="p-6">
      <h2 className="m-0 mb-4 text-[#0b3d91] text-2xl font-semibold">IPL Motion Cards</h2>
      <div className="grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
        {cards.map((card) => (
          <HoverCardMotion key={`${card.type}-${card.name}`} {...card} />
        ))}
      </div>
    </section>
  );
}
