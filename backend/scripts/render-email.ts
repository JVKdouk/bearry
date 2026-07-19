/* Render a sample daily digest email to HTML (run: yarn tsx scripts/render-email.ts <out.html>). */
import { writeFileSync } from "node:fs";
import { renderTemplate, mdLiteToHtml, emailShell, type DigestData } from "../src/lib/digest/build";

const data: DigestData = {
  range: "day",
  label: "Sunday, July 12",
  firstName: "Demo",
  events: [
    { time: "10:00 AM", title: "Team standup" },
    { time: "2:00 PM", title: "Design review" },
    { time: "4:00 PM", title: "1:1 with Sam" },
  ],
  tasks: [
    { title: "Submit quarterly tax documents", priority: "ASAP", due: "Sun" },
    { title: "Reply to investor email", priority: "high", due: "Sun" },
    { title: "Buy oat milk & groceries", priority: "low", due: "Mon" },
  ],
  overdue: 1,
  freeTime: false,
};

const text = renderTemplate(data);
const html = emailShell(mdLiteToHtml(text));
const out = process.argv[2] ?? "/tmp/email.html";
writeFileSync(out, html);
console.log("wrote", out);
