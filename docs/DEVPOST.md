# Riff: Devpost Submission Copy

> **Not for pasting.** Everything under a `##` heading below is paste-ready into the matching Devpost field. Blocks marked `[DAYTONA. Paste only if the handoff shipped]` are the only conditional text. If Daytona didn't ship, delete those blocks and paste the rest as-is. Nothing else needs editing.

---

## 1. Tagline

Design out loud. A voice partner that draws as you talk.

*(56 characters. If the field is tighter, use: "Design out loud.")*

---

## 2. Inspiration

The best idea I had this year showed up while I was driving. No laptop. No Figma. So I talked it into my phone.

What I got back was a transcript. A wall of text I never opened again.

That's the gap. Designers get their best ideas away from the canvas: driving, walking, in the shower. Voice notes capture the words. They don't capture the design. By the time you're back at a screen, the idea has flattened into a paragraph, and you're reverse-engineering your own thinking.

I wanted the other thing. Talk, and see it.

---

## 3. What it does

Riff is a voice-first design partner. You hit the mic and describe what you're thinking. It talks back the way a senior designer would: one sharp clarifying question, not a questionnaire. Then it draws.

Two kinds of artifact. Low-fidelity wireframes, rendered as phone frames. And user flows, rendered as a node graph. Both live on a pan and zoom canvas that refits itself as screens appear.

The part I actually care about is what happens second. Say "add a screen where they pick a time slot and pay" and Riff doesn't start over. The screens already on the canvas stay byte-identical. The new screen goes in where it belongs in the flow, not tacked on the end. And on the screen before it, a button relabeled itself from "Confirm Booking" to "Continue to Payment", because that screen isn't the last step anymore.

Nobody asked for that relabel. It reasoned about the flow.

That's the line between a generator and a collaborator, and it's the whole reason this thing exists.

Voice isn't always the right input. Open office, loud room, bad day. So the same loop runs typed, through a CopilotKit sidebar. Same agent, same artifact, same canvas.

---

## 4. How we built it

The loop is four moving parts and one contract.

The contract is an artifact schema: a wireframe is a title plus screens, a screen is a vertical stack of typed elements, a flow is nodes and edges. Everything else builds against that one type.

**Voice** is an ElevenLabs Conversational AI agent. Claude Sonnet as the brain, Flash v2 for speech. Its system prompt isn't "be helpful", it's a job description: you are a senior design partner, ask one question at a time, never monologue. It has a client tool called `render_artifact` that runs in the browser.

**Generation** is Fireworks. The tool call posts a brief to a Next.js route, which hits `glm-5p1` with JSON-schema structured output and the schema restated in the prompt. When an artifact already exists, it goes back in with instructions to edit it rather than regenerate it. That single decision is what makes the evolve moment work.

**Rendering** is mine. React Flow canvases with custom nodes: phone frames for wireframes, dagre-laid-out graphs for flows. No component library did this. The renderer reads the same schema the model writes to, so if the model is right, the canvas is right.

**The text path** is CopilotKit, pointed at the same generation route. It was insurance against a noisy demo room, and it turned into a genuine second input mode.

**Braintrust** logs every generation: brief in, artifact out, model, latency. The eval question I find interesting isn't whether it drew something. It's whether the artifact matches what I actually said. That one is hard to score and I don't have a good scorer for it yet. It's the first thing I'd build next.

`[DAYTONA. Paste only if the handoff shipped]`
**Handoff** is Daytona. The artifact is structured data, not a picture, so it can leave the canvas. "Hand off to build" ships the artifact into a Daytona sandbox and hands back something running. Idea in the car, artifact on screen, URL you can click.
`[END DAYTONA]`

One more thing about the build, since it's true and most submissions won't say it. I wrote almost none of this code. It was built by AI subagents working in parallel, coordinated by an orchestrator thread that never wrote a line itself. My job was the concept, the file boundaries between agents, and every judgment call about what it should feel like. Which is roughly the job I do anyway.

---

## 5. Challenges we ran into

**Five out of six renders were dying silently.** The demo would work, then not work, then work. No errors. I found it by reading the live API transcripts instead of my own logs, and the cause wasn't in my code at all: ElevenLabs aborts an in-flight client tool call the moment the user speaks again. Generation takes 11 to 19 seconds. People do not stay quiet for 19 seconds. Every time I filled the silence, I killed my own render.

The fix was to stop treating generation as part of the conversation turn. `render_artifact` now fires the request and returns immediately with a line for the agent to say. The artifact lands out of band when it's ready, guarded by an incrementing request ID so a slow old response can never overwrite a newer canvas. The conversation and the drawing run on separate clocks now, which is what they always should have done.

**Structured output is the slow part.** Free text streams, so it feels instant. Layout doesn't, because you can't render half a schema. That's the 11 to 19 seconds and I couldn't engineer it away in a day. So I designed around it instead: the wait is scripted into the demo, and I say the number out loud rather than hiding it behind a spinner.

**Getting the model to edit instead of regenerate.** The default behavior of any model handed an artifact and a change request is to produce a fresh, slightly different artifact. That reads as broken to a designer, because the thing you were looking at just moved. Getting existing screens to survive a revision byte-identical took several passes at the prompt and the schema, and it's the difference between a toy and a partner.

**Parallel agents fight over files.** Two agents editing the same component at the same time costs more than doing it serially. The coordination primitive that worked was disjoint file ownership: every agent gets its own files and nobody shares.

---

## 6. Accomplishments that we're proud of

The button that relabeled itself. Three screens stayed exactly where they were, a payment screen went in at the right point in the flow, and a button on an untouched-looking screen changed its own copy because its role in the flow had changed. I didn't build that behavior. I built the conditions for it, and then it happened.

The loop is real end to end. Spoken sentence to rendered artifact, live, no pre-baked screens and no video trickery.

The fallback isn't a fallback. Because voice and text run through the same generation path, the typed mode is a real second way to use the product rather than a demo safety net that only I know about.

And naming the wait. Eleven to nineteen seconds is a long time on stage. Saying so is better than pretending.

---

## 7. What we learned

**Read the transcripts, not your logs.** My logs said everything was fine. The platform's transcript said the tool call was abandoned. The bug wasn't in my code, it was in an assumption I'd made about someone else's contract, and only their data could show me that.

**Latency is a design material.** Once you accept the wait is real, it stops being a bug and becomes a beat you can write for. The 19 second gap in this demo is where the entire concept gets explained. That's not a workaround. It's better than filling it with a spinner.

**A voice agent's persona is design work, not prompt engineering.** The difference between dictation and a design partner is one paragraph of job description. Ask one question. Never monologue. Draw when you have enough.

**Voice-first changes what "the interface" means.** Conversation is the interface. The artifact replaces the transcript. Every design decision after that follows from it.

---

## 8. What's next for Riff

**Score the thing I can't score yet.** Braintrust has every generation logged. The next step is a real scorer for "does this artifact match what the person said", which is the eval question underneath the whole product.

**Cut the wait.** Partial rendering, screen by screen, so the canvas starts filling at three seconds instead of everything landing at fifteen.

**A fidelity ladder.** These are wireframes. Deliberately. But "make that one real" should be a sentence you say, not a different tool you open.

**Handoff to running code.** The artifact is structured data, so it can become a sandbox, a repo, a clickable prototype. Idea in the car, something you can tap by the time you park.

**Put it where the idea actually happens.** I built this on a laptop, and the moment it's for is a phone in a car. That gap is worth closing.

---

## 9. Built With

```
elevenlabs
fireworks-ai
copilotkit
braintrust
daytona
next.js
react
typescript
tailwindcss
zustand
react-flow
dagre
node.js
vercel
```

*(Drop `daytona` if the handoff didn't ship.)*
