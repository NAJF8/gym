import glob
import json
import cv2
import zxingcpp

detector = cv2.QRCodeDetector()
decoded = []
for path in sorted(glob.glob('output/qr/exercise-*.png')):
    image = cv2.imread(path)
    value, points, _ = detector.detectAndDecode(image)
    if not value:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        value, points, _ = detector.detectAndDecode(gray)
    if not value:
        ok, points = detector.detect(image)
        if ok:
            corners = points[0].astype('float32')
            size = 600
            destination = __import__('numpy').array([[0, 0], [size - 1, 0], [size - 1, size - 1], [0, size - 1]], dtype='float32')
            warped = cv2.warpPerspective(image, cv2.getPerspectiveTransform(corners, destination), (size, size))
            value, _, _ = detector.detectAndDecode(warped)
    if not value:
        results = zxingcpp.read_barcodes(image)
        value = results[0].text if results else ''
    decoded.append({'file': path, 'value': value})
print(json.dumps({'count': len(decoded), 'decoded': decoded}, ensure_ascii=False))
