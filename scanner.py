import sys
import cv2
import numpy as np

def order_points(pts):
    # Ordena 4 puntos en orden: top-left, top-right, bottom-right, bottom-left
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect

def process_image(image_path):
    try:
        image = cv2.imread(image_path)
        if image is None:
            print("ERROR_LOAD")
            return

        orig = image.copy()
        
        # 1. Grayscale & Blur
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray_blur = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # 2. Canny Edge Detection
        edged = cv2.Canny(gray_blur, 75, 200)

        # 3. Encontrar el contorno del documento
        contours, _ = cv2.findContours(edged.copy(), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]

        screenCnt = None
        for c in contours:
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)
            # Si el contorno tiene 4 esquinas, asumimos que es el CMR
            if len(approx) == 4:
                screenCnt = approx
                break

        fallback = False
        if screenCnt is not None:
            # 4. Perspective Transform (Aplanar imagen)
            pts = screenCnt.reshape(4, 2)
            rect = order_points(pts)
            (tl, tr, br, bl) = rect

            widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
            widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
            maxWidth = max(int(widthA), int(widthB))

            heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
            heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
            maxHeight = max(int(heightA), int(heightB))

            dst = np.array([
                [0, 0],
                [maxWidth - 1, 0],
                [maxWidth - 1, maxHeight - 1],
                [0, maxHeight - 1]], dtype="float32")

            M = cv2.getPerspectiveTransform(rect, dst)
            warped = cv2.warpPerspective(orig, M, (maxWidth, maxHeight))
            warped_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
        else:
            # REGLA DEL FALLBACK
            fallback = True
            warped_gray = gray

        # 5. Adaptive Threshold (Efecto Escáner B/N que elimina sombras)
        scanned = cv2.adaptiveThreshold(warped_gray, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 10)

        # 6. Sobrescribir el archivo original
        cv2.imwrite(image_path, scanned)

        # 7. Retornar status al proceso padre (Node)
        if fallback:
            print("OK_FALLBACK")
        else:
            print("OK")

    except Exception as e:
        print(f"ERROR_PY: {str(e)}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("ERROR_ARGS")
        sys.exit(1)
    
    process_image(sys.argv[1])
    sys.stdout.flush()
