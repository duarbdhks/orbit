# Orbit 캐릭터

사용자가 지정한 흰색 고양이 로봇을 사용한다. 프로필 배경은 `#DCE8EF`다.

- `character.png`는 프로필 원본이다.
- `icon.png`는 Slack 업로드용 512px 정사각형이다.
- `emoji.png`는 배경을 제거한 캐릭터다.
- `working.gif`는 96px, 24프레임의 대기 리액션이다. 자동 애니메이션을 끈 Slack에서도 첫 프레임이 보인다.

ImageMagick이 설치된 환경에서 `node scripts/render_orbit.mjs`로 프로필과 GIF를 다시 만든다. 스크립트는 128KB 미만과 프레임 수를 검사한다. 애셋 생성은 런타임 의존성이 아니다.
