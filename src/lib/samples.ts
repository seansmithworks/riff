import type { Artifact } from "./artifact";

// Real generated output (climbing gym session booking brief) captured from
// the live model — schema-valid, kept verbatim as the "See an example" seed.
export const SAMPLE_WIREFRAME: Artifact = {
  kind: "wireframe",
  title: "ClimbBook — Climbing Gym Session Booking",
  screens: [
    {
      id: "home",
      name: "Home — Upcoming Sessions",
      elements: [
        { type: "navbar", title: "ClimbBook" },
        { type: "heading", text: "Upcoming Sessions" },
        {
          type: "list",
          items: [
            {
              title: "Bouldering Basics — The Crimp Club",
              subtitle: "Tue, Mar 12 · 6:30 PM · 3 spots left",
              hasImage: true,
            },
            {
              title: "Lead Climbing Clinic — Summit Vertical",
              subtitle: "Thu, Mar 14 · 7:00 PM · Waitlist #2",
              hasImage: true,
            },
            {
              title: "Open Climb — Granite State Gym",
              subtitle: "Sat, Mar 16 · 10:00 AM · Confirmed",
              hasImage: true,
            },
          ],
        },
        { type: "divider" },
        { type: "heading", text: "Recommended Near You" },
        {
          type: "list",
          items: [
            {
              title: "Vertical World Seattle",
              subtitle: "4.8 ★ · 2.1 mi · 12 sessions open",
              hasImage: true,
            },
            {
              title: "Seattle Bouldering Project",
              subtitle: "4.9 ★ · 3.4 mi · 8 sessions open",
              hasImage: true,
            },
          ],
        },
        { type: "tabbar", tabs: ["Home", "Search", "Profile"], active: 0 },
      ],
    },
    {
      id: "search",
      name: "Gym Search with Filters",
      elements: [
        { type: "navbar", title: "Find Gyms", actions: ["Back"] },
        { type: "searchbar", placeholder: "Search by gym name or city" },
        { type: "heading", text: "Filters" },
        {
          type: "row",
          children: [
            { type: "button", label: "Indoor", variant: "primary" },
            { type: "button", label: "Outdoor", variant: "secondary" },
          ],
        },
        {
          type: "row",
          children: [
            { type: "button", label: "Bouldering", variant: "primary" },
            { type: "button", label: "Top Rope", variant: "secondary" },
            { type: "button", label: "Lead", variant: "secondary" },
          ],
        },
        {
          type: "input",
          label: "Max Distance",
          placeholder: "Within 10 miles",
        },
        { type: "divider" },
        { type: "heading", text: "12 Gyms Matching" },
        {
          type: "list",
          items: [
            {
              title: "Vertical World Seattle",
              subtitle: "Indoor · Top Rope, Lead · 2.1 mi",
              hasImage: true,
            },
            {
              title: "Seattle Bouldering Project",
              subtitle: "Indoor · Bouldering · 3.4 mi",
              hasImage: true,
            },
            {
              title: "Exit 38 Outdoor Climbing",
              subtitle: "Outdoor · Sport, Trad · 8.7 mi",
              hasImage: true,
            },
            {
              title: "Stone Gardens Climbing",
              subtitle: "Indoor · Bouldering, Top Rope · 4.0 mi",
              hasImage: true,
            },
          ],
        },
        { type: "tabbar", tabs: ["Home", "Search", "Profile"], active: 1 },
      ],
    },
    {
      id: "gym-detail",
      name: "Gym Detail & Booking Confirmation",
      elements: [
        {
          type: "navbar",
          title: "Vertical World Seattle",
          actions: ["Back", "Share"],
        },
        {
          type: "image",
          label: "Gym interior with lead wall and bouldering area",
          aspect: "wide",
        },
        {
          type: "card",
          title: "Vertical World Seattle",
          body: "Seattle's original climbing gym since 1987. 18,000 sq ft of lead, top rope, and bouldering terrain. Auto-belays available. Gear rental on-site.",
          hasImage: false,
        },
        { type: "heading", text: "Available Sessions This Week" },
        {
          type: "list",
          items: [
            {
              title: "Bouldering Open Session",
              subtitle: "Mon, Mar 11 · 5:00 PM · $18 · 6 spots",
            },
            {
              title: "Lead Climbing Clinic",
              subtitle: "Wed, Mar 13 · 7:00 PM · $35 · 4 spots",
            },
            {
              title: "Family Climb Hour",
              subtitle: "Sat, Mar 16 · 10:00 AM · $22 · 8 spots",
            },
          ],
        },
        {
          type: "row",
          children: [
            { type: "button", label: "Save Gym", variant: "secondary" },
            { type: "button", label: "Book Session", variant: "primary" },
          ],
        },
        { type: "divider" },
        {
          type: "card",
          title: "Booking Confirmed",
          body: "Lead Climbing Clinic — Wed, Mar 13 at 7:00 PM. Confirmation #VW-3392. Bring your own harness or rent on-site for $5. Cancellation free until 24 hours prior.",
          hasImage: false,
        },
      ],
    },
  ],
};

// A signup-with-verification flow, with a decision branch.
export const SAMPLE_FLOW: Artifact = {
  kind: "flow",
  title: "Signup Flow",
  nodes: [
    { id: "start", label: "Start", type: "start" },
    { id: "landing", label: "Landing Page", type: "screen" },
    { id: "signup", label: "Signup Form", type: "screen" },
    { id: "has-account", label: "Email already exists?", type: "decision" },
    { id: "login", label: "Login Screen", type: "screen" },
    { id: "send-otp", label: "Send verification code", type: "action" },
    { id: "verify", label: "Verify Code", type: "screen" },
    { id: "onboarding", label: "Onboarding", type: "screen" },
    { id: "end", label: "End", type: "end" },
  ],
  edges: [
    { from: "start", to: "landing" },
    { from: "landing", to: "signup", label: "Get Started" },
    { from: "signup", to: "has-account" },
    { from: "has-account", to: "login", label: "Yes" },
    { from: "has-account", to: "send-otp", label: "No" },
    { from: "login", to: "onboarding" },
    { from: "send-otp", to: "verify" },
    { from: "verify", to: "onboarding" },
    { from: "onboarding", to: "end" },
  ],
};
