# Đế Chế Web — bản làm lại phi thương mại trên trình duyệt (theo Age of Empires I: The Rise of Rome)

Bản làm lại **Đế Chế 1** chạy hoàn toàn trên trình duyệt, tập trung vào cách cộng đồng Việt Nam hay chơi:
bản đồ **Hill Country**, luật **D3KT (Đời 3 Không Thành)**, chơi mạng tới **8 người** (Solo, 2vs2, 3vs3, 4vs4).

Chỉ số, công nghệ và thưởng phe lấy thẳng từ dữ liệu gốc `empires.dat`. Các công thức chiến đấu và cây công nghệ được
dịch ngược từ file exe gốc (xem [Dữ liệu & cơ chế gốc](#dữ-liệu--cơ-chế-gốc)). Hình và tiếng gốc dùng được khi có bản
cài Age of Empires: Rise of Rome; nếu không có, game tự vẽ hình và tổng hợp âm thanh bằng code.

## Chạy game

Yêu cầu: [Node.js](https://nodejs.org) 18 trở lên.

```bash
npm install
npm start
```

Mở trình duyệt (Chrome / Edge / Firefox) tại **http://localhost:3000**.

### Chơi mạng (LAN / Internet)

1. Một người chạy `npm start` (máy chủ). Màn hình console sẽ in địa chỉ LAN, ví dụ `http://192.168.1.10:3000`.
2. Những người khác mở địa chỉ đó → **Chơi mạng** → nhập tên → vào phòng.
3. Chủ phòng chọn thiết lập (hoặc bấm preset *Solo Random D3KT*, *4vs4 Random*, *Solo Shang*...), mọi người bấm **Sẵn sàng**, chủ phòng bấm **Bắt đầu trận**.

Chơi qua Internet: mở cổng 3000 trên router, hoặc dùng mạng LAN ảo (Radmin VPN, ZeroTier, Tailscale) giống hồi chơi ở quán net.
Đổi cổng: `PORT=4000 npm start`.

Nếu rớt mạng giữa trận, chỉ cần mở lại trang và vào **Chơi mạng**: game tự kết nối lại và tua nhanh tới thời điểm hiện tại.

Bấm **Xem** ở danh sách phòng để vào **xem trận** (observer) — kể cả khi trận đang diễn ra — với bảng tài nguyên, dân, lính của mọi người chơi (tiện cho bình luận viên / stream).

## Hình, tiếng, nhạc gốc

Game đọc được dữ liệu của **Age of Empires: The Rise of Rome 1.0**, kể cả các bản cài "AoE HD" của cộng đồng VN.

### Chép thẳng vào dự án (khuyên dùng)

```powershell
node tools/import-aoe.mjs "C:\Users\<bạn>\Downloads\AoE-HD\AoE-HD"
npm start
```

Script chép vào `public/assets/aoe/` các file sau:

- `empires.dat`, `graphic.drs`, `sound.drs`;
- `interfac.drs`, được lọc gọn: bỏ ảnh SHP và chỉ giữ ảnh nền menu ở độ phân giải lớn nhất;
- `tileedge.dat`, `blkedge.dat`, `shadow.col`;
- build list của máy (`data2/*.ai`) vào `ai/`;
- taunt, tiếng môi trường, nhạc `.mid` trong `sound/`;
- `gm.dls` của Windows (bộ mẫu âm "Microsoft GS Wavetable Synth" mà nhạc MIDI của AoE dùng).

Game tự nạp các file này khi mở, không cần chọn gì thêm. Bạn bè vào máy chủ của bạn qua LAN cũng thấy hình gốc.
Thư mục này đã có trong `.gitignore`: **đừng đưa nó lên GitHub hay chia sẻ công khai**, vì đó là file có bản quyền của Microsoft
(chỉ dùng cá nhân).

### Hai cách khác

1. **Trong trình duyệt:** menu chính → **Chọn thư mục game AoE...**. File chỉ đọc trong trình duyệt và được lưu vào IndexedDB.
   Cách này không có nhạc, vì thiếu `gm.dls`.
2. **Qua máy chủ cục bộ:** chạy `$env:AOE_DIR = "C:\đường\dẫn\AoE"; npm start` (PowerShell). Route `/aoe-data` chỉ trả lời
   127.0.0.1. Nhạc dùng `gm.dls` lấy từ thư mục Windows.

### Những gì đổi sang bản gốc

- **Lính, dân, thú:** sprite gốc 8 hướng. Dân có hoạt ảnh theo nghề và vác tài nguyên; xác chết phân hủy dần.
- **Nhà:** theo kiến trúc phe và theo đời; có giàn giáo, lửa khi hư, đổ nát khi bị phá.
- **Địa hình:** vẽ từng ô y như exe: ô cỏ/cát theo mẫu 3×3 của bản gốc, **ô dốc gốc đã đổ bóng sẵn** chọn theo độ cao
  8 ô xung quanh, **viền chuyển cỏ ↔ cát** (từng mảnh mép đặt lên ô), cây rừng gốc (thông, cọ, rừng rậm), **vách đá** ghép
  từ 25 mảnh gốc, đồ trang trí mặt đất (bụi cỏ, đá, xương, vết nứt, xương rồng).
- **Giao diện AoE HD:** thanh tài nguyên và bảng điều khiển theo 5 kiến trúc (Ai Cập, Hy Lạp, Lưỡng Hà, Á Đông, La Mã);
  nút Menu/Ngoại giao; icon lệnh, icon công/giáp/giáp tên, thanh máu và con trỏ chuột gốc; ảnh nền màn hình chính
  (đền Rise of Rome), phòng chờ và bảng điểm.
- **Âm thanh:**
  - tiếng gốc khi chọn/ra lệnh, đánh, bắn, chặt, đào mỏ, tù và báo động, **"wololo"** thật;
  - gõ một số trong chat (VD `11`) để phát taunt;
  - **nhạc nền MIDI gốc** (`open.mid` ở menu, `music1–16` trong trận, `won/lost.mid` cuối trận) phát qua bộ tổng hợp
    WebAudio viết riêng (`audio/dls.js`, `audio/midi.js`, `audio/music.js`) bằng chính mẫu âm `gm.dls`, nghe như khi
    chạy trên Windows. Bật/tắt trong Menu F10.

Chưa hỗ trợ bản Definitive Edition (định dạng SLD/SMX khác hoàn toàn).

**Lưu ý bản quyền.** Age of Empires © Microsoft Corporation. Đế Chế Web là dự án cá nhân, học tập, phi thương mại; không được
Microsoft bảo trợ hay liên kết. Bộ [Game Content Usage Rules](https://www.xbox.com/en-US/developers/rules) của Microsoft chỉ cho
dùng cá nhân, phi thương mại, và cấm reverse engineer để lấy asset. Vì vậy: không phát tán các file `.drs`, `.dat`, `.wav`,
`.mid`, `.dls`, không thu phí, không gắn quảng cáo. Định dạng file tham khảo từ dự án mã nguồn mở
[openage](https://github.com/SFTtech/openage).

## Dữ liệu & cơ chế gốc

`public/src/engine/data/original.js` được sinh từ `empires.dat` bằng lệnh:

```bash
node tools/gen-data.mjs "C:\đường\dẫn\AoE\data\empires.dat"   # mặc định: public/assets/aoe/empires.dat
```

File này chứa máu, tầm nhìn, tốc độ, danh sách **công/giáp theo lớp**, tầm bắn, thời gian nạp, độ chính xác, đạn,
sát thương lan, giá, thời gian tạo của mọi đơn vị và công trình; 127 công nghệ (giá, thời gian, điều kiện, hiệu ứng);
lệnh hiệu ứng; và cây công nghệ/thưởng của 16 phe. Các bảng `units.js`, `buildings.js`, `techs.js`, `civs.js` chỉ thêm
tên tiếng Việt, phím tắt, mô tả.

### Dịch ngược từ `empires.exe` (RoR 1.0, 1998)

Tìm bằng cách đọc mã máy (disassembly) của exe gốc:

- **Sát thương** = tổng theo các lớp đòn của `max(0, (công − giáp cùng lớp) × hệ số độ cao)`. Lớp không có trong danh sách
  giáp dùng **giáp mặc định** (0 với mọi đơn vị thường). Đòn khắc chế là giáp âm: bộ binh có giáp lớp 9 = −5 nên kỵ binh +5;
  nhà có giáp lớp 6 = −140 nên cẩu đá +140; chòi/thành có lớp 1 = −7 nên lính ném đá +7; Siegecraft cộng 150 vào lớp 10
  của dân để đánh chòi/thành...
- **Máu là số thực**, mỗi đòn **trừ tối thiểu 1 máu**; riêng cung thủ và chòi canh/gác bắn lính thì tối thiểu chỉ **0,1**.
  **Công trình nhận đủ sát thương** (không có hệ số giảm).
- **Độ cao:** đánh xa từ chỗ cao hơn ×1,5; cận chiến đứng thấp hơn mục tiêu ×2/3. So sánh độ cao z chính xác như bản gốc.
- **Sát thương lan** (cẩu đá, voi, xe lưỡi hái): trúng đủ sát thương mọi vật có mép nằm trong bán kính, nếu "mức chống lan"
  của vật ≥ mức lan của đòn (cẩu đá to mới phá được cây). Voi và xe lưỡi hái không giẫm quân mình; cẩu đá thì trúng cả quân mình.
- **Độ chính xác:** mỗi đòn tung xác suất `rand×100/32767 ≤ accuracy` (dân săn 80%, cá sấu 60%).
- **Cây công nghệ:** mỗi người chơi có bản sao dữ liệu đơn vị riêng.
  - Mỗi công nghệ có trạng thái: bị cấm / khóa / sẵn sàng / đang nghiên cứu / xong.
  - Sau mỗi lần nghiên cứu, công nghệ đủ điều kiện mà có thời gian 0 tự hoàn thành, ví dụ "Kho lương + Đời 2 → Chợ",
    "Nhà chính phủ → được xây thêm Nhà chính".
  - Công trình xây xong tự nghiên cứu công nghệ của nó.
  - Lệnh hiệu ứng `set` / `add` / `mul` tác động lên từng thuộc tính (công/giáp mã hóa `lớp×256+giá trị`, thuộc tính 100
    là giá, 101 là dân số...); nâng cấp quân thay cả lính đang có lẫn lính trong hàng chờ.
- **Xây nhà:** mỗi dân cộng `1 × tốc độ làm việc` giây công vào công trình, **nhiều dân thì cộng thẳng** (2 dân xây nhanh gấp
  đôi, không giảm dần như AoE2).
- **Sửa nhà:** hồi máu bằng 0,75 × 0,4 = **0,3 tốc độ xây**, trả dần **nửa giá công trình** cho đầy máu; hết tài nguyên thì dừng.
- **Cải đạo:** phù thủy cần đầy phép; cứ **3 giây** niệm thử một lần, thành công nếu `rand × kháng ≤ 0,3 × tốc độ làm việc`.
  Kháng: quân Macedonia ×4, xe chiến/xe cung ×8, phù thủy và thuyền ×2, còn lại ×1. Không cải đạo được nhà chính, tường,
  kỳ quan, phế tích. **Chữa:** 3 máu/giây (×3 với Medicine).
- **Bản đồ ngẫu nhiên** (`engine/rms.js`): chép lại từng bộ sinh của exe, theo đúng thứ tự gốc, dùng cả bộ sinh số ngẫu nhiên
  `rand()` của MSVC:
  1. **Đặt người chơi:** chọn ngẫu nhiên, cách nhau ít nhất `(rộng − 20)/√n` (×0,9 với 4–6 người, ×0,8 với 7–8), ngoài
     một ô vuông giữa bản đồ, nên người chơi ở gần mép.
  2. **Đồi:** 4 tầng, mỗi tầng mọc thành cụm quanh hạt giống với hàng ưu tiên như exe, tránh nhà chính. Hill Country được ×5
     diện tích đồi. Sau mỗi tầng có 3 lượt làm phẳng để mọi ô đều vẽ được bằng ô dốc gốc.
  3. **Vách đá** (75% số bản đồ): bước ngẫu nhiên trên lưới ô 3×3 cùng độ cao, rẽ 36%, Hill Country nhiều và dài hơn.
     Đường giữa vách là địa hình "cỏ không đi được"; mảnh vách chọn từ bảng 20 kiểu nối của exe.
  4. **Địa hình:** cát 10% thành 4 cụm (không tránh nhà chính), cọ trên cát, rừng thông 10%, rừng 4%, rừng rậm 1%. Cứ 4 bản
     đồ có 1 bản "sa mạc": cát ×2, cọ ×3, rừng giảm nửa.
  5. **Vật thể:** mật độ cây và đồ trang trí theo từng loại địa hình; đặt tài nguyên theo khoảng cách hình vuông tới nhà chính
     (vàng 12–18 và 21–35 ô, đá 10–18 và 20–35, quả rải trong bán kính 3, mỏ mọc thành cụm). Bản đồ to hơn có nhiều nhóm hơn.
- **Kích thước bản đồ:** Small 72, Medium 96, Normal 120, Large 144, Huge 200, Gigantic 250.
- **Sương mù** (khi có dữ liệu gốc): ô ngoài tầm nhìn vẽ qua **lưới bàn cờ** — cứ một điểm ảnh thì xóa một điểm thành màu 0
  (đen), lệch một điểm mỗi hàng; ô chưa khám phá không vẽ. Mép giữa sáng / sương / đen lấy hình từ `tileedge.dat` (phần ô
  sáng bị vẽ sương) và `blkedge.dat` (phần ô đã khám phá để đen): mỗi kiểu dốc có 47 kiểu mép, chọn theo 8 ô xung quanh
  ô nào chưa thấy / chưa khám phá. Nhà, cây, mỏ đứng trên ô trong sương được vẽ nguyên hình qua lưới bàn cờ. Khi màn hình
  bị co giãn lẻ (zoom 1,5, Windows 125%...), lưới bàn cờ đổi thành tối 50% để khỏi bị nhòe vân.
- **Cuộn màn hình:** cả khung hình dịch theo số nguyên điểm ảnh, nên mặt đất và vật trên đó (đá, cỏ, cây) không lệch nhau khi
  cuộn. Lưới bàn cờ đứng yên trên màn hình như bản gốc (005459A0 chọn mặt nạ theo dòng màn hình), nên camera nhảy 2 điểm
  ảnh một lần. Nếu nhảy lẻ, cả vùng sương sẽ nháy đen/sáng mỗi khung. Lăn chuột phóng to/thu nhỏ theo bước 10%, quay về đúng ×1.
- **Thấy gì trong sương** (cờ "fog visibility" của từng loại đơn vị, 00451FD0): trên ô đã khám phá nhưng ngoài tầm nhìn chỉ
  còn thú hoang, mỏ, bụi quả, xác thú, vách đá, Kỳ quan và cây còn đứng; **lính và nhà của người khác (kể cả đồng minh chưa
  có Writing) biến mất vào sương**, không nhớ lại như AoE2 — cả trên bản đồ nhỏ và khi click.
- **Chim bay** (Pigeon 95/96, bộ sinh bản đồ đặt vài cặp, bản đồ to nhiều hơn): bay ở độ cao 6 tới một điểm ngẫu nhiên của
  bản đồ, tới nơi thì chọn điểm mới; cứ 5–15 giây đổi giữa vỗ cánh và lượn; bóng in dưới đất (hành động bay, 00402140).
- **Thú hoang** (`engine/animals.js`, AI đơn vị của exe; 004B13D0 chọn module theo lớp: Hươu lớp 9; Voi, Sư tử, Cá sấu
  cùng lớp 10 nhưng mỗi con một module riêng):
  - Con nào cũng có "đồng hồ rảnh": phải rảnh đủ `rand() % (gốc/2) + 3/4 gốc` mili-giây (gốc 3 giây, Hươu 4, Sư tử 6) mới
    nhìn quanh một lần, nên thú phản ứng chậm vài giây. Thú chỉ chạy khi bị kích động, không đi lang thang.
  - Tầm nhìn tính theo ô, bằng bảng vòng tròn 16×16 của game (cùng bảng dùng để mở sương mù).
  - **Hươu:** thấy dân, lính, phù thủy hay thú dữ (cả Sư tử, Voi) trong 2 ô thì nhảy thẳng ra xa 3 × tốc độ (3,3 ô). Bị đánh
    thì chạy ngược hướng mọi kẻ đang đánh nó 4 × tốc độ (4,4 ô; đang chạy thì 8,4 ô). Khi chạy dùng sprite "nhảy" nhanh 1,9×
    (2,09 ô/giây). Hươu không bao giờ đánh.
  - **Voi:** không đụng ai cho tới khi bị đánh, rồi lao vào kẻ đánh (đi bộ 1,0 ô/giây). Voi đuổi tới khi mục tiêu ra khỏi tầm
    nhìn của thú Gaia, rồi đi về chỗ nó bắt đầu lao vào. Vì vậy dụ voi về nhà kho được như bản gốc.
  - **Sư tử:** cứ 4,5–7,5 giây nhìn quanh 3 ô, vồ thứ gần nhất trong danh sách của nó: dân, lính, phù thủy… và cả **Hươu**.
    Sư tử đuổi bằng sprite chạy (2,09 ô/giây) và bỏ cuộc khi mục tiêu ra ngoài 3 ô. Nếu không tới được mục tiêu, nó nằm nghỉ
    19–31 giây.
  - **Cá sấu** (và các con "King"): nhìn 5 ô, vồ đơn vị người chơi gần nhất, không đụng tới Hươu.
  - Bị đánh khi đang rảnh, Sư tử và Cá sấu quay lại cắn kẻ đánh. Dân bị thú cắn thì ném giáo săn lại con thú, xẻ thịt xong
    mới quay về việc cũ; lính bị thú cắn thì đánh trả.

### Từ dữ liệu gốc và tài liệu cộng đồng

- **Khai thác:** tốc độ và sức mang lấy từ đơn vị "nghề" (Lumberjack 0,55; Forager/Hunter/Miner 0,45; ruộng 0,4) cộng hiệu
  ứng công nghệ, ví dụ Woodworking +0,2 và +2.
- **Ruộng** 250 thịt (+75 mỗi công nghệ chợ). **Cống nạp** mất thuế 25% (Coinage/Palmyra 0%).
- Phép phù thủy hồi 2/giây (Fanaticism +1,5).

- **Máy (AI)** đi theo **build list gốc** (`data2\*.ai`), chọn như exe (004F5AD0): mỗi phe một bảng trọng số riêng
  (vd. Ai Cập: War Elephants 40, Chariots 33, Chariot Archer 33, Priest 16…; Babylon chủ yếu "Babylon Scouts", Ba Tư
  "Persia Elephant Archers"), mọi chiến lược trong 7 nhóm quân (thầy tu, kỵ, cung ngựa, voi, bộ binh, cung, công thành)
  chia 3 (vài cái chia 9), rồi bốc theo `rand()`; mức Khó nhất dùng danh sách "Immortal" nếu phe có, Deathmatch dùng
  danh sách Death Match. Danh sách làm theo thứ tự, hai mục một lúc: nhà (xây lại khi mất), lính (U thay khi chết, T giới
  hạn số lần), công nghệ (R bỏ qua nếu không làm được, **C bắt buộc: chặn cả danh sách tới khi xong**). Đánh lần đầu theo
  chiến lược: rush đời đá 5–6 phút, đời công cụ 11–14, chiến lược đời đồng 20–25, còn lại 28–39 (Khó nhất: 1/3 khả năng
  sớm 5 phút); nhóm đánh 2–10 quân. Lính đứng yên của cả người lẫn máy tự đánh địch trong tầm nhìn (mức Dễ / Dễ nhất chỉ
  thu hẹp tầm này khi chơi scenario). Luật D3KT / Cung R vẫn áp dụng cho máy (mục bị cấm thì tạm bỏ qua).

Chưa làm: phần còn lại của AI gốc (chọn nhóm đánh, ngoại giao, "học" theo người chơi), dân bị lính địch đánh thì bỏ chạy
(AI dân gốc), bản đồ có nước.

## Tính năng

- **Bản đồ Hill Country** (và Highland) sinh bằng thuật toán gốc: không có nước, nhiều đồi, rừng thông/cọ, vùng cát, vách đá tạo điểm nghẽn; kích thước Small 72 → Gigantic 250.
- **16 phe của Rise of Rome** với đúng thưởng phe và cây công nghệ gốc + phe **Lạc Việt** (từ bản DE, tùy chọn).
  5 bộ kiến trúc: Ai Cập, Lưỡng Hà, Hy Lạp, Á Đông, La Mã; nhà đổi hình theo đời.
- **4 đời**, 127 công nghệ gốc (khoảng 70 công nghệ bấm được), khoảng 35 loại lính với chỉ số gốc.
- Tên bay theo quỹ đạo (chạy để né, Ballistics để bắn đón đầu), phù thủy cải đạo (Wololo!) cần đầy phép, hàng chờ chỉ 1 loại
  quân, chọn tối đa 25 quân, dân mất tài nguyên khi đổi việc, ruộng chặn đường, thú chết vì lính không cho thịt...
- **Luật chơi Việt Nam** (game tự chặn vi phạm):
  - **D3KT – Đời 3 Không Thành**: cấm Thành & Chòi; trước khi lên xong đời 3 chỉ được 1 lính; không dùng dân đánh dân / đập nhà (trừ nhà BE) của đối thủ trước đời 3.
  - **Cung R** (giải Shang/Assy): đời 2 không có Cung T, đời 3 chỉ ra Cung R (xe cung) tới phút 25 hoặc đời 4; chưa có Wheel không được đánh dân & nhà BE.
  - **Tự do** và **Deathmatch** (20000 tài nguyên, cấm thành).
- **Chơi mạng lockstep** như AoE gốc: máy chủ chỉ chuyển tiếp lệnh, mọi máy mô phỏng giống hệt nhau (có kiểm tra mất đồng bộ), chat tất cả / đồng đội, tạm dừng (F3), kết nối lại.
- **Máy (AI)** 5 mức độ, theo build list gốc của từng phe: phát triển kinh tế, săn voi, làm ruộng, lên đời, ra quân và đánh theo đợt.
- **Cheat cổ điển**: `pepperoni pizza`, `coinage`, `woodstock`, `quarry`, `steroids`, `reveal map`, `no fog`, `home run`, `diediedie`, `kill1..8`, `bigdaddy`, `photon man`, `e=mc2 trooper`, `hoyohoyo`, `icbm`, `big bertha` (bật "Cho phép cheat" trong phòng).
- Màn hình **Thành tích** sau trận, **lưu & xem lại replay**, cống nạp tài nguyên, sương mù chiến tranh, bản đồ nhỏ hình thoi.

## Điều khiển

| Phím / chuột | Tác dụng |
|---|---|
| Chuột trái, kéo | Chọn (tối đa 25). Shift: thêm. Nhấp đúp: chọn mọi quân cùng loại trên màn hình |
| Chuột phải | Đi / đánh / khai thác / xây / sửa / cải đạo / chữa. Với công trình: đặt điểm tập kết |
| **B** + chữ | Xây: **BE** nhà, **BB** nhà lính, **BG** kho lương, **BS** nhà kho, **BF** ruộng, **BM** chợ, **BA** nhà cung, **BL** chuồng ngựa, **BP** đền, **BC** nhà chính phủ, **BK** xưởng cẩu, **BY** học viện, **BN** nhà chính, **BO** kỳ quan |
| Nhà chính | **C** tạo dân · **T / B / I** lên đời 2 / 3 / 4 |
| Nhà cung | **T** Cung T · **A** Cung A · **R** Cung R · **C** Cung C (cung ngựa) · **Y** Cung Y (voi cung) |
| Chuồng ngựa | **S** ngựa dò · **C** ngựa chém · **R** xe chiến · **M** lạc đà · **E** voi |
| Nhà lính | **C** lính chùy/rìu · **S** kiếm · **L** ném đá |
| Shift + nút tạo quân | Xếp 5 quân |
| Ctrl + 1..9 / 1..9 | Gán / chọn nhóm (bấm 2 lần để nhảy tới) |
| H · . (dấu chấm) | Nhà chính · dân đang rảnh |
| S · Delete | Dừng · xóa |
| Enter / Shift+Enter | Chat tất cả / đồng đội (gõ cheat ở đây) |
| F3 · F10 · Space | Tạm dừng · Menu · về quân đang chọn |
| Mũi tên, chuột ra mép, lăn chuột, chuột giữa | Di chuyển / phóng to bản đồ |
| + / − | Tốc độ game (chơi đơn) |

## Thiết lập chuẩn của cộng đồng VN

Random Map · Hill Country · Large (Solo/2vs2), Huge (3vs3), Gigantic (4vs4) · Conquest · tài nguyên mặc định
(200 thịt, 200 gỗ, 0 vàng, 150 đá) · dân số 200 · tốc độ 2.0 · phe ngẫu nhiên · đồng đội đứng gần nhau · luật D3KT.
Đây cũng là thiết lập mặc định khi tạo phòng.

## Cấu trúc mã nguồn

```
server/server.js            máy chủ HTTP + WebSocket: phòng chờ, chuyển tiếp lệnh lockstep, kết nối lại
server/aoedata.js           route /aoe-data (tùy chọn AOE_DIR, chỉ 127.0.0.1): file game, nhạc, gm.dls
tools/import-aoe.mjs        chép file game (+ gm.dls) vào public/assets/aoe
tools/gen-data.mjs          sinh engine/data/original.js + original-map.js từ empires.dat, original-ai.js từ ai/*.ai
public/src/engine/          mô phỏng tất định (không phụ thuộc trình duyệt, chạy được trong Node)
  techtree.js               cây công nghệ & lệnh hiệu ứng như exe gốc
  data/original.js          dữ liệu gốc (sinh tự động)    data/ids.js  id của game ↔ id trong empires.dat
  data/                     tên, vai trò, phím tắt của lính, công trình, công nghệ, 17 phe
  world.js player.js        thế giới, thực thể, tick, hash đồng bộ; người chơi & chỉ số
  behavior.js combat.js     hành vi đơn vị, công thức sát thương gốc, đạn, cải đạo
  animals.js                thú hoang: AI đơn vị gốc của Hươu, Voi, Sư tử, Cá sấu
  production.js rules.js    tạo quân, nghiên cứu, lên đời; luật D3KT / Cung R
  rms.js mapgen.js          bộ sinh bản đồ ngẫu nhiên chép từ exe; chuyển sang bản đồ của game
  pathfind.js               A* có giới hạn
  ai.js cheats.js           máy chơi (theo build list gốc: data/ai-strategies.js, data/original-ai.js); mã cheat
public/src/render/          vẽ isometric: địa hình (từng ô như exe: ô dốc, viền), sprite, sương mù, minimap
  fog-layer.js              sương mù gốc: lưới bàn cờ + mép từ tileedge/blkedge.dat, vẽ theo chunk
  birds.js                  chim bay (chỉ để nhìn, không thuộc mô phỏng)
  aoe-render.js             vẽ bằng sprite gốc (khi đã nạp), tự quay về hình vẽ code nếu thiếu
public/src/assets/          đọc dữ liệu gốc: drs.js (DRS), slp.js (SLP 2.0N), dat.js (empires.dat), aoe.js (sprite,
                            giao diện, ảnh nền, âm thanh), edges.js (mép sương mù), mapping.js, loader.js
                            (assets/aoe / thư mục / AOE_DIR)
public/src/audio/           sfx.js (tiếng), midi.js + dls.js + music.js (nhạc MIDI qua gm.dls)
public/src/ui/hud.js        giao diện trong trận (giao diện AoE HD khi có dữ liệu gốc)
public/src/game/            vòng lặp lockstep, điều khiển chuột/phím
tests/                      kiểm thử mô phỏng, luật chơi, định dạng file, trình duyệt
```

Mô phỏng chạy 10 tick/giây (thời gian game), mỗi lượt lockstep = 2 tick. Chỉ dùng phép toán tất định
(không `Math.sin/cos/pow`) và RNG có seed, nên mọi máy cho kết quả giống hệt nhau.

## Kiểm thử

```bash
npm test                         # luật & công thức gốc + thú hoang + bản đồ ngẫu nhiên + định dạng DRS/SLP/MIDI/DLS + AI vs AI + tất định
# với dữ liệu game thật (PowerShell): $env:AOE_DIR = "C:\Games\Age of Empires"; node tests/assets.test.mjs; npm run test:aoe
node tests/sim.test.mjs --min=30 --players=8 --size=gigantic
node tests/browser.mjs out play  # test giao diện bằng Edge/Chrome có sẵn trên máy (cần devDependencies)
```
