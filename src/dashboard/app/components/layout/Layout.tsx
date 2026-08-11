import React from "react";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-7xl mx-auto min-h-screen px-5 py-6">
      {children}
    </main>
  );
}
