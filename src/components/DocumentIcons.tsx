import React from 'react';

export function WordPdfLogo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="36" height="36" rx="9" fill="#2563EB" />
      <path
        d="M9 11.5C9 10.6716 9.67157 10 10.5 10H18.2L22.5 14.3V24.5C22.5 25.3284 21.8284 26 21 26H10.5C9.67157 26 9 25.3284 9 24.5V11.5Z"
        fill="#FFFFFF"
      />
      <path d="M18.2 10L22.5 14.3H19C18.5582 14.3 18.2 13.9418 18.2 13.5V10Z" fill="#BFDBFE" />
      <path
        d="M12.2 17.5L13.5 22L14.8 18.5L16.1 22L17.4 17.5"
        stroke="#2563EB"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="20.5" y="16" width="8.5" height="10.5" rx="2" fill="#0F172A" />
      <path
        d="M22.8 19.5H25C25.8284 19.5 26.5 20.1716 26.5 21C26.5 21.8284 25.8284 22.5 25 22.5H22.8V19.5Z"
        stroke="#FFFFFF"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path d="M22.8 22.5V24.2" stroke="#FFFFFF" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

export function WordDocIcon({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M8 6.5C8 4.84315 9.34315 3.5 11 3.5H23.5L32 12V33.5C32 35.1569 30.6569 36.5 29 36.5H11C9.34315 36.5 8 35.1569 8 33.5V6.5Z"
        fill="#EFF6FF"
        stroke="#2563EB"
        strokeWidth="1.75"
      />
      <path
        d="M23.5 3.5V10.5C23.5 11.3284 24.1716 12 25 12H32"
        stroke="#2563EB"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <rect x="11.5" y="17.5" width="17" height="13" rx="2.5" fill="#2563EB" />
      <path
        d="M15.2 21.3L17.1 26.7L19 22.3L20.9 26.7L22.8 21.3"
        stroke="#FFFFFF"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PdfDocIcon({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M8 6.5C8 4.84315 9.34315 3.5 11 3.5H23.5L32 12V33.5C32 35.1569 30.6569 36.5 29 36.5H11C9.34315 36.5 8 35.1569 8 33.5V6.5Z"
        fill="#FEF2F2"
        stroke="#DC2626"
        strokeWidth="1.75"
      />
      <path
        d="M23.5 3.5V10.5C23.5 11.3284 24.1716 12 25 12H32"
        stroke="#DC2626"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <rect x="11.5" y="17.5" width="17" height="13" rx="2.5" fill="#DC2626" />
      <text
        x="20"
        y="26.3"
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize="7.4"
        fontWeight="700"
        fontFamily="Plus Jakarta Sans, sans-serif"
        letterSpacing="0.04em"
      >
        PDF
      </text>
    </svg>
  );
}
