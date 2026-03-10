type GlossaryItem = {
  title: string;
  category: string;
  meaning: string;
  watch: string;
  caution: string;
};

const GLOSSARY_ITEMS: GlossaryItem[] = [
  {
    title: "다르바스 박스",
    category: "박스 돌파",
    meaning:
      "일정 기간 고점과 저점이 박스처럼 갇힌 구간을 말합니다. 상단 돌파는 추세 재개 신호, 하단 이탈은 박스 실패 신호로 해석합니다.",
    watch: "상단 돌파 뒤 거래량이 붙는지, 하단 지지선을 다시 지키는지 확인합니다.",
    caution: "거래량 없는 돌파는 가짜 돌파일 수 있어 재진입 또는 재지지 확인이 필요합니다.",
  },
  {
    title: "NR7",
    category: "변동성 수축",
    meaning:
      "최근 7개 봉 중 가격 범위가 가장 좁은 봉입니다. 에너지가 압축된 상태라 이후 방향이 정해지면 빠르게 움직일 가능성이 있습니다.",
    watch: "다음 봉이 NR7 고점 위로 나가는지, 거래량이 평균 이상 붙는지 봅니다.",
    caution: "수축만으로 방향은 알 수 없어서 돌파 전 선진입은 보수적으로 접근해야 합니다.",
  },
  {
    title: "템플릿",
    category: "추세 필터",
    meaning:
      "대체로 미너비니 추세 템플릿 계열을 뜻하며, 이동평균 정배열과 중장기 상승 구조가 유지되는지 보는 기준입니다.",
    watch: "주가가 장기 이평 위에 있고, MA20/60/120 같은 구조가 상향 정렬되는지 확인합니다.",
    caution: "템플릿이 좋아도 이미 과열이면 눌림 없이 추격하는 전략은 불리할 수 있습니다.",
  },
  {
    title: "RSI",
    category: "모멘텀",
    meaning:
      "상승과 하락 강도를 상대적으로 보여주는 모멘텀 지표입니다. 높을수록 강세, 낮을수록 약세로 읽습니다.",
    watch: "70 이상 과열, 30 이하 과매도보다도 50선 위 유지와 다이버전스 발생 여부를 함께 봅니다.",
    caution: "강한 추세장에서는 RSI가 오래 과열권에 머물 수 있어 단독 매도 신호로 쓰면 오판하기 쉽습니다.",
  },
  {
    title: "수급",
    category: "매매 주체",
    meaning:
      "외국인, 기관, 개인, 프로그램 같은 주체가 최근에 얼마나 사고팔았는지를 뜻합니다. 가격 움직임을 받쳐주는 자금 흐름을 보는 용도입니다.",
    watch: "외국인/기관 동시 순매수, 프로그램 동행 여부, 외국인 보유율 추세를 함께 확인합니다.",
    caution: "단일 하루 수급보다 여러 영업일 누적 흐름이 더 중요하며, 수급만 보고 추세를 무시하면 위험합니다.",
  },
  {
    title: "컵앤핸들",
    category: "지속 패턴",
    meaning:
      "완만한 U자형 컵과 짧은 핸들 조정 뒤 돌파를 노리는 패턴입니다. 추세 중간의 재축적 구조로 해석합니다.",
    watch: "컵 우측 복원, 핸들 깊이 축소, 네크라인 근처 거래량 증가 여부가 핵심입니다.",
    caution: "핸들이 너무 깊거나 거래량 없이 네크라인만 건드리면 실패 확률이 높습니다.",
  },
  {
    title: "거래대금",
    category: "자금 강도",
    meaning:
      "가격과 거래량을 곱한 값으로, 실제 얼마나 큰 돈이 들어왔는지를 보여줍니다. 거래량보다 세력 개입 흔적을 더 잘 드러냅니다.",
    watch: "최근 20일 평균 대비 급증했는지, 고점/저점 어느 위치에서 터졌는지를 봅니다.",
    caution: "거래대금 급증이 항상 매집은 아니며, 분배나 설거지일 수도 있어 위치 해석이 중요합니다.",
  },
  {
    title: "설거지+눌림목",
    category: "거래대금 전략",
    meaning:
      "큰 거래대금이 한번 터진 뒤 조정·횡보가 나오고, 다시 자금이 붙은 이후 눌림목을 만드는 구간을 보수적으로 노리는 전략입니다.",
    watch: "앵커 스파이크 뒤 조정 폭, 재유입 거래대금, 눌림 구간 거래대금 감소, invalidLow를 같이 봅니다.",
    caution: "남은 물량 정리 반등일 수도 있어 invalidLow 이탈 시 전략 무효로 보고 빠르게 리스크를 줄여야 합니다.",
  },
  {
    title: "VCP",
    category: "수축 패턴",
    meaning:
      "Volatility Contraction Pattern의 약자로, 변동성이 단계적으로 줄고 거래량이 마르다가 저항 돌파를 준비하는 구조입니다.",
    watch: "수축 깊이 감소, dry-up, 저항까지 거리, RS 강도를 함께 확인합니다.",
    caution: "수축 횟수나 깊이가 기준에 못 미치면 비슷해 보여도 false positive가 많습니다.",
  },
  {
    title: "거래량 패턴",
    category: "확증/경고",
    meaning:
      "돌파 확인, 불트랩, 눌림 재축적, 투매 흡수 같은 캔들+거래량 조합을 자동으로 분류한 것입니다.",
    watch: "BRK는 확증, TRAP은 경고, PB는 눌림 재개처럼 각 패턴의 톤을 구분해서 해석합니다.",
    caution: "하나의 패턴만 보지 말고 추세, 지지/저항, 수급과 겹치는지 확인해야 신뢰도가 올라갑니다.",
  },
];

export default function GlossaryPanel() {
  return (
    <section className="glossary-panel">
      <div className="card glossary-intro">
        <h3>용어 안내</h3>
        <p className="meta">
          차트와 카드에 자주 나오는 표현을 한 곳에 모았습니다. 각 용어는 단독 신호보다 추세, 거래대금,
          지지/저항과 함께 해석하는 편이 안전합니다.
        </p>
      </div>

      <div className="glossary-grid">
        {GLOSSARY_ITEMS.map((item) => (
          <article key={item.title} className="card glossary-card">
            <div className="glossary-head">
              <strong>{item.title}</strong>
              <small className="signal-tag neutral">{item.category}</small>
            </div>
            <p>{item.meaning}</p>
            <p>
              <strong>확인 포인트</strong>
              <br />
              {item.watch}
            </p>
            <p>
              <strong>주의할 점</strong>
              <br />
              {item.caution}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
