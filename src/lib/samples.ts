import type { Artifact } from "./artifact";

// Dog-walking app: Home (search + list), Detail (image + card + actions),
// Booking (inputs + confirm).
export const SAMPLE_WIREFRAME: Artifact = {
  kind: "wireframe",
  title: "Pawmise — Dog Walking",
  screens: [
    {
      id: "home",
      name: "Home",
      elements: [
        { type: "navbar", title: "Pawmise", actions: ["Profile"] },
        { type: "searchbar", placeholder: "Search walkers near you" },
        { type: "heading", text: "Available today" },
        {
          type: "list",
          items: [
            {
              title: "Jamie R.",
              subtitle: "4.9 stars · 0.4mi away",
              hasImage: true,
            },
            {
              title: "Alex T.",
              subtitle: "4.8 stars · 0.7mi away",
              hasImage: true,
            },
            {
              title: "Morgan L.",
              subtitle: "5.0 stars · 1.1mi away",
              hasImage: true,
            },
            {
              title: "Casey P.",
              subtitle: "4.7 stars · 1.5mi away",
              hasImage: true,
            },
          ],
        },
        {
          type: "tabbar",
          tabs: ["Home", "Bookings", "Messages", "Profile"],
          active: 0,
        },
      ],
    },
    {
      id: "detail",
      name: "Walker Detail",
      elements: [
        { type: "navbar", title: "Jamie R.", actions: ["Share"] },
        { type: "image", label: "Jamie R.", aspect: "wide" },
        { type: "heading", text: "Jamie R." },
        {
          type: "text",
          text: "4.9 stars · 212 walks completed · Certified pet first aid",
        },
        {
          type: "card",
          title: "About",
          body: "Been walking dogs in the neighborhood for 5 years. Loves big energetic breeds.",
          hasImage: false,
        },
        { type: "divider" },
        {
          type: "row",
          children: [
            { type: "button", label: "Message", variant: "secondary" },
            { type: "button", label: "Book Walk", variant: "primary" },
          ],
        },
      ],
    },
    {
      id: "booking",
      name: "Booking",
      elements: [
        { type: "navbar", title: "Book a Walk", actions: ["Cancel"] },
        { type: "input", label: "Dog name", placeholder: "e.g. Biscuit" },
        { type: "input", label: "Date & time", placeholder: "Today, 4:30 PM" },
        { type: "input", label: "Duration", placeholder: "30 minutes" },
        { type: "text", text: "Estimated total: $22.00" },
        { type: "button", label: "Confirm Booking", variant: "primary" },
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
