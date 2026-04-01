type FileBadgeProps = {
  label: string;
};

export function FileBadge({ label }: FileBadgeProps) {
  return <span className="file-badge">{label}</span>;
}
