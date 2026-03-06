interface FavoriteButtonProps {
  active: boolean;
  onClick: () => void;
  small?: boolean;
}

export default function FavoriteButton(props: FavoriteButtonProps) {
  const { active, onClick, small = false } = props;
  return (
    <button
      type="button"
      className={small ? (active ? "favorite-btn active small" : "favorite-btn small") : active ? "favorite-btn active" : "favorite-btn"}
      aria-pressed={active}
      onClick={onClick}
      title={active ? "관심종목 해제" : "관심종목 추가"}
    >
      {small ? (active ? "★" : "☆") : `${active ? "★" : "☆"} ${active ? "관심중" : "관심"}`}
    </button>
  );
}
