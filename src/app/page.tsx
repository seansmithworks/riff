import { Header } from "@/components/Header";
import { ArtifactCanvas } from "@/components/ArtifactCanvas";
import { ConversationPanel } from "@/components/ConversationPanel";

export default function Home() {
  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-950">
      <Header />
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <main className="flex-1 overflow-hidden">
          <ArtifactCanvas />
        </main>
        <ConversationPanel />
      </div>
    </div>
  );
}
