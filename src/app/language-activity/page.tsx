import React, { Suspense } from "react";
import LanguageActivityClient from "./LanguageActivityClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-600">Loading...</div>}>
      <LanguageActivityClient />
    </Suspense>
  );
}
