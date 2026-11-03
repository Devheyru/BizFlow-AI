import React from "react";
import { Loader2 } from "lucide-react";

export default function InvitationAcceptanceLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-md p-8 text-center space-y-4">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600 dark:text-blue-400" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Validating invitation link...
        </p>
      </div>
    </div>
  );
}
