type IconProps = { size?: number };

const Stroke = ({
  size = 28,
  children,
}: IconProps & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const ScanFeatureIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
    <path d="M8 9.5h8M8 13h5" />
    <path d="M15.5 13v3.5h2.5" />
  </Stroke>
);

export const ReadFeatureIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M12 6.5C9.3 4.7 6 4.9 3.8 5.5v12c2.2-.5 5.5-.7 8.2 1.2 2.7-1.9 6-1.7 8.2-1.2v-12C18 4.9 14.7 4.7 12 6.5Zm0 0v12.2" />
  </Stroke>
);

export const HighlightsFeatureIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M4 6.5h16M4 11.5h12M4 16.5h9" />
    <path d="M16.5 16.5h3.5" strokeWidth={2.6} />
  </Stroke>
);

export const GoogleG = ({ size = 18 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.859-3.0477.859-2.344 0-4.3282-1.5831-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z"
    />
    <path
      fill="#FBBC05"
      d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z"
    />
    <path
      fill="#EA4335"
      d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z"
    />
  </svg>
);
