# TaoClip Desktop

Ứng dụng dựng video chạy cục bộ trên Windows, xây bằng Electron, React, Vite và FFmpeg. TaoClip hỗ trợ dựng timeline nhiều lớp, công cụ AI tùy chọn và xuất video cho các tỉ lệ phổ biến.

**Website:** [taoclip.com](https://taoclip.com) · **Tải bản Windows:** [taoclip.com/tai-ve](https://taoclip.com/tai-ve/)

![Giao diện TaoClip Desktop](assets/taoclip-desktop-screenshot.png)

## Chức năng

- Nhập video, ảnh, GIF và audio; sắp xếp, trim, split, crop và thay đổi tốc độ clip.
- Dựng timeline nhiều track (hình ở trên, tiếng ở dưới): kéo thả file vào đúng track và thời điểm, tách âm thanh khỏi video, menu chuột phải (sao chép, nhân bản, tách, khung hình dừng, tăng cường…), chọn nhiều và kéo nhóm, cắt mép bằng chuột, xóa dồn, mốc, bảng thuộc tính theo mục đang chọn (vị trí, xoay, lật, mờ, tốc độ, âm lượng, cân bằng), thêm chữ, sticker, phụ đề, nhạc nền và chuyển cảnh.
- Nhiều timeline trong một project (tab Timeline 1, Timeline 2…) để làm nhiều tập hoặc nhiều clip; thư viện media dùng chung, mỗi tab có lịch sử hoàn tác riêng.
- Phân tích khoảng lặng, tạo phụ đề, đọc văn bản và xử lý nền bằng các model AI tải riêng.
- Lưu/mở project, relink media, thu thập media để chuyển project, undo/redo và khôi phục phiên.
- Xuất MP4 bằng CPU hoặc encoder GPU khả dụng, chọn chất lượng (Cao/Chuẩn/Nhỏ gọn), độ phân giải cạnh ngắn (720/1080/1440) và xuất nhiều tỉ lệ. Tốc độ khung hình xuất cố định 30 fps; tỉ lệ Gốc giữ kích thước của clip đầu tiên.
- Tải media từ URL, dùng Google Cloud TTS và đổi khuôn mặt là các tính năng tùy chọn cần kết nối/cấu hình phù hợp.

## Yêu cầu

- Windows x64 để đóng gói hoặc chạy installer theo cấu hình hiện tại.
- Node.js và npm cho môi trường phát triển.
- Internet khi cài dependencies hoặc tải model/tool lần đầu.

## Chạy bản phát triển

```bash
npm install
npm run dev
```

## Kiểm tra

```bash
npm run build
npm test
npm run test:ai
npm run test:dl
npm run test:face
```

`npm test` chạy kiểm tra schema/timeline, kiểm tra tĩnh renderer (lỗi dùng biến trước khi khai báo làm trắng màn hình lúc mở app, khóa i18n thiếu) và bộ test engine FFmpeg. Chưa có test giao diện tự động; cần thao tác thử trong Electron trước khi phát hành.

`npm run test:e2e` mở app Electron thật (bản build trong `dist/`, userData riêng) và điều khiển bằng chuột, thả file và xuất MP4 thật qua Chrome DevTools Protocol. Test này mở cửa sổ app nên không nằm trong `npm test`; thêm `--skip-build` nếu `dist/` vừa build, hoặc một từ khóa để chỉ chạy kịch bản khớp tên.

Một số kiểm tra AI/tải xuống cần Internet và có thể tải file lớn.

## Đóng gói Windows

```bash
npm run dist
```

Electron Builder tạo installer trong `release/`. Installer chưa ký số nếu môi trường build không có chứng thư ký.

## Dữ liệu và model bên thứ ba

Video, ảnh, audio và project được xử lý trên máy. Nếu bật Google Cloud TTS, đoạn văn bản bạn chọn sẽ được gửi tới Google để tổng hợp giọng nói. Model AI và công cụ được tải khi chạy có chủ sở hữu và điều khoản riêng; MIT license của mã nguồn TaoClip không cấp quyền phân phối lại các model đó. Hãy kiểm tra điều khoản của từng model trước khi sử dụng hoặc phân phối.

Các thư mục `models/` và `bin/yt-dlp.exe` chỉ là bộ nhớ đệm khi phát triển, không nằm trong git và không được đóng gói vào installer; ứng dụng tải chúng khi cần.

Chỉ tải media bạn có quyền sử dụng. Chỉ dùng tính năng đổi khuôn mặt khi có quyền và sự đồng ý phù hợp.

## Đóng góp và báo lỗi

Mở issue hoặc pull request trên GitHub. Khi báo lỗi, ghi phiên bản app, phiên bản Windows, thao tác tái hiện và trạng thái CPU/GPU. Không đính kèm API key, dữ liệu riêng tư hoặc media nhạy cảm.

## Ghi công

Bộ sticker trong `src/renderer/public/stickers/twemoji/` lấy từ [Twemoji](https://github.com/jdecked/twemoji) (Twitter, Inc. và cộng sự). Hình ảnh được phát hành theo [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), khác với code MIT của dự án. Nếu bạn phân phối lại các sticker này, giữ ghi công Twemoji.

## License

Mã nguồn TaoClip Desktop được phát hành theo MIT License. Xem [LICENSE](LICENSE).
