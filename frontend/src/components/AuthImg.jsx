import { useAuthFileUrl } from "@/lib/authFileUrl";

/** <img> com ficheiro autenticado via Bearer (sem JWT na URL). */
export default function AuthImg({ path, alt = "", className, style, onClick, ...rest }) {
  const src = useAuthFileUrl(path);
  if (!path) return null;
  if (!src) {
    return (
      <span
        className={className}
        style={{ ...style, display: "inline-block", background: "#f3f4f6" }}
        aria-hidden
      />
    );
  }
  return (
    <img src={src} alt={alt} className={className} style={style} onClick={onClick} {...rest} />
  );
}
