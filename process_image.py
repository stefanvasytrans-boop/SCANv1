import cv2
import sys
import os

def process_image(input_path):
    if not os.path.exists(input_path):
        print("ERROR: Archivo no encontrado", file=sys.stderr)
        sys.exit(1)

    # 1. Leer imagen
    img = cv2.imread(input_path)

    # --- MAGIA OPENCV AQUÍ ---
    # (Ejemplo: Convertir a escala de grises y añadir un texto de seguridad)
    processed = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cv2.putText(processed, "PROCESAT DE RAILWAY", (50, 50), 
                cv2.FONT_HERSHEY_SIMPLEX, 1.5, (255, 255, 255), 3)

    # 2. Guardar output con prefijo _out
    output_path = input_path.replace('.jpg', '_out.jpg')
    cv2.imwrite(output_path, processed)

    # 3. Imprimir por consola el path resultante (Node.js está escuchando esto)
    print(output_path)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("ERROR: Falta el argumento del archivo", file=sys.stderr)
        sys.exit(1)
        
    process_image(sys.argv[1])
