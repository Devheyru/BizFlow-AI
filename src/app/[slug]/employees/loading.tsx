import React from "react";

export default function EmployeesLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex justify-between items-center pb-5 border-b border-gray-200 dark:border-gray-800">
        <div className="space-y-2">
          <div className="h-8 w-64 bg-gray-200 dark:bg-gray-800 rounded"></div>
          <div className="h-4 w-96 bg-gray-200 dark:bg-gray-800 rounded"></div>
        </div>
        <div className="h-10 w-36 bg-gray-200 dark:bg-gray-800 rounded"></div>
      </div>

      <div className="flex gap-4">
        <div className="h-10 w-64 bg-gray-200 dark:bg-gray-800 rounded"></div>
        <div className="h-10 w-32 bg-gray-200 dark:bg-gray-800 rounded"></div>
      </div>

      <div className="h-96 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4">
        <div className="h-6 w-full bg-gray-200 dark:bg-gray-800 rounded"></div>
        <div className="h-6 w-full bg-gray-200 dark:bg-gray-800 rounded"></div>
        <div className="h-6 w-full bg-gray-200 dark:bg-gray-800 rounded"></div>
        <div className="h-6 w-full bg-gray-200 dark:bg-gray-800 rounded"></div>
      </div>
    </div>
  );
}
