import { Suspense } from "react";
import ExpressionClient from "./ExpressionClient";

export const dynamic = "force-dynamic";

export default function ExpressionPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white text-black p-8">
          <div className="max-w-6xl mx-auto">
            <div className="rounded-md border border-gray-300 p-4 text-sm text-gray-700">
              Loading expression…
            </div>
          </div>
        </div>
      }
    >
      <ExpressionClient />
    </Suspense>
  );
}
