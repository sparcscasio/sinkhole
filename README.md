# 업데이트 및 배포 절차

아래 절차는 **Colab 환경에서 백엔드 실행 후 프론트엔드에 ngrok 터널을 반영하여 서비스를 재배포**하는 전체 흐름이다.

### 1. Colab 환경 실행
- Google Colab에서 노트북을 열고 **모든 셀을 순차적으로 실행**한다.
- 마지막 셀 실행 결과로 생성되는 **ngrok 터널 URL**을 확인한다.  
  - 형식: `https://{id}.ngrok-free.app/`
  - 이후 단계에서 `{id}` 값만 사용한다.

### 2. 프론트엔드 설정 수정
- `App.tsx` 파일의 **17번째 줄**에서 API 엔드포인트 설정을 수정한다.
- 1단계에서 확인한 ngrok URL의 `{id}` 값을 `CODE` 변수에 입력한다.

### 3. 변경사항 커밋 및 배포
터미널에서 아래 명령어를 순서대로 실행한다.

```bash
git add .
git commit -m "new commit"
git push -u origin master
npm run deploy
```
변경된 설정을 GitHub에 반영한 뒤, 배포 스크립트를 통해 서비스를 업데이트한다.

### 4. 관련 링크
- google colab = https://colab.research.google.com/drive/1HhpxK7LZTY2XX6ehrMbVKU6wMBrXoqp5?usp=sharing
- github page = https://github.com/sparcscasio/sinkhole
