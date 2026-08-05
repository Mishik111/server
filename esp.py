import time
import cv2
import numpy as np
import win32gui
import win32ui
import win32con
import win32process
import win32api
import pymem
import pymem.process
import keyboard
import math
import ctypes
import sys
from ctypes import wintypes

class ExternalESPOffsets:
    """Чтение памяти GTA5.exe через оффсеты"""
    
    def __init__(self):
        self.pm = None
        self.client = None
        self.process_name = "GTA5.exe"
        
        # Оффсеты GTA 5 (требуют обновления под версию игры)
        self.offsets = {
            "world_ptr": 0x254C9D0,
            "local_player": 0x8,
            "player_info": 0x10C8,
            "player_health": 0x280,
            "player_armor": 0x14B8,
            "player_pos": 0x90,
            "view_matrix": 0x253D1D0,
        }
        
        self.attach_to_process()
        
    def attach_to_process(self):
        """Подключение к процессу игры"""
        try:
            print(f"[*] Поиск процесса: {self.process_name}")
            self.pm = pymem.Pymem(self.process_name)
            self.client = pymem.process.module_from_name(
                self.pm.process_handle, 
                "GTA5.exe"
            )
            print(f"[+] Успешно подключено к GTA5.exe")
            print(f"[+] Базовый адрес: {hex(self.client.lpBaseOfDll)}")
            return True
        except pymem.exception.ProcessNotFound:
            print(f"[-] Процесс {self.process_name} не найден!")
            print("[*] Убедитесь, что GTA 5 запущена")
            return False
        except Exception as e:
            print(f"[-] Ошибка: {e}")
            return False
    
    def read_vec3(self, address):
        """Чтение вектора XYZ"""
        try:
            x = self.pm.read_float(address)
            y = self.pm.read_float(address + 0x4)
            z = self.pm.read_float(address + 0x8)
            return (x, y, z)
        except:
            return (0, 0, 0)
    
    def get_view_matrix(self):
        """Получение матрицы вида"""
        if not self.client:
            return None
        try:
            base = self.client.lpBaseOfDll
            matrix_addr = base + self.offsets["view_matrix"]
            matrix = []
            for i in range(16):
                matrix.append(self.pm.read_float(matrix_addr + (i * 4)))
            return matrix
        except:
            return None
    
    def world_to_screen(self, world_pos, width, height):
        """Конвертация мировых координат в экранные"""
        view_matrix = self.get_view_matrix()
        if not view_matrix:
            return None
        
        x = world_pos[0] * view_matrix[0] + world_pos[1] * view_matrix[1] + world_pos[2] * view_matrix[2] + view_matrix[3]
        y = world_pos[0] * view_matrix[4] + world_pos[1] * view_matrix[5] + world_pos[2] * view_matrix[6] + view_matrix[7]
        w = world_pos[0] * view_matrix[12] + world_pos[1] * view_matrix[13] + world_pos[2] * view_matrix[14] + view_matrix[15]
        
        if w < 0.001:
            return None
        
        inv_w = 1.0 / w
        screen_x = (x * inv_w + 1.0) * width * 0.5
        screen_y = (1.0 - y * inv_w) * height * 0.5
        
        return (int(screen_x), int(screen_y))
    
    def get_local_player(self):
        """Получение локального игрока"""
        if not self.client:
            return 0
        try:
            base = self.client.lpBaseOfDll
            world_ptr = self.pm.read_longlong(base + self.offsets["world_ptr"])
            if world_ptr:
                return self.pm.read_longlong(world_ptr + self.offsets["local_player"])
        except:
            pass
        return 0
    
    def get_players(self):
        """Получение списка игроков"""
        players = []
        if not self.client:
            return players
            
        try:
            base = self.client.lpBaseOfDll
            world_ptr = self.pm.read_longlong(base + self.offsets["world_ptr"])
            if not world_ptr:
                return players
            
            local_player = self.get_local_player()
            local_ped = 0
            if local_player:
                try:
                    local_ped = self.pm.read_longlong(local_player + 0x30)
                except:
                    pass
            
            for i in range(32):
                try:
                    player_addr = self.pm.read_longlong(base + self.offsets["player_info"] + (i * 8))
                    if player_addr:
                        ped = self.pm.read_longlong(player_addr + 0x30)
                        if ped and ped != local_ped:
                            health = self.pm.read_float(ped + self.offsets["player_health"])
                            pos = self.read_vec3(ped + self.offsets["player_pos"])
                            
                            if 0 < health <= 200 and pos != (0, 0, 0):
                                players.append({
                                    'health': health,
                                    'position': pos,
                                    'name': f"Player_{i}"
                                })
                except:
                    continue
        except Exception as e:
            print(f"[-] Ошибка: {e}")
        
        return players


class SimpleESPOverlay:
    """Простой ESP оверлей через OpenCV (гарантированно работает)"""
    
    def __init__(self):
        self.esp = ExternalESPOffsets()
        self.running = True
        
    def run(self):
        """Запуск ESP"""
        print("\n" + "="*60)
        print("ESP OVERLAY - GTA 5 RAGE MP")
        print("="*60)
        print("[*] Нажмите 'Q' для выхода")
        print("[*] Окно ESP будет поверх игры\n")
        
        # Создаем окно OpenCV
        window_name = "GTA 5 ESP - RAGE MP"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        
        # Получаем размеры экрана
        screen_width = win32api.GetSystemMetrics(0)
        screen_height = win32api.GetSystemMetrics(1)
        
        # Устанавливаем размер окна
        window_width = 800
        window_height = 600
        cv2.resizeWindow(window_name, window_width, window_height)
        
        # Делаем окно поверх всех окон
        hwnd = None
        timeout = time.time() + 5  # 5 секунд на поиск окна
        while hwnd is None and time.time() < timeout:
            hwnd = win32gui.FindWindow(None, window_name)
            time.sleep(0.1)
        
        if hwnd:
            # Устанавливаем окно поверх всех
            win32gui.SetWindowPos(
                hwnd, 
                win32con.HWND_TOPMOST,  # Поверх всех окон
                100, 100,                # Позиция
                window_width, window_height,
                win32con.SWP_SHOWWINDOW
            )
            print("[+] Окно ESP установлено поверх всех окон")
            print("[*] Переместите окно в удобное место")
        else:
            print("[-] Не удалось найти окно ESP")
        
        # Создаем кисти для рисования
        green_color = (0, 255, 0)  # BGR формат
        red_color = (0, 0, 255)
        white_color = (255, 255, 255)
        
        fps = 0
        frame_count = 0
        last_time = time.time()
        
        while self.running:
            # Создаем черный фон
            canvas = np.zeros((window_height, window_width, 3), dtype=np.uint8)
            
            # Получаем игроков
            players = self.esp.get_players()
            local_player = self.esp.get_local_player()
            local_pos = (0, 0, 0)
            
            if local_player and self.esp.client:
                try:
                    local_ped = self.esp.pm.read_longlong(local_player + 0x30)
                    if local_ped:
                        local_pos = self.esp.read_vec3(local_ped + self.esp.offsets["player_pos"])
                except:
                    pass
            
            # Отрисовываем игроков
            for player in players:
                screen_pos = self.esp.world_to_screen(
                    player['position'],
                    screen_width,
                    screen_height
                )
                
                if screen_pos:
                    # Масштабируем координаты под размер окна
                    sx = int(screen_pos[0] * window_width / screen_width)
                    sy = int(screen_pos[1] * window_height / screen_height)
                    
                    # Расчет расстояния
                    distance = math.sqrt(
                        (player['position'][0] - local_pos[0])**2 +
                        (player['position'][1] - local_pos[1])**2 +
                        (player['position'][2] - local_pos[2])**2
                    ) if local_pos != (0, 0, 0) else 0
                    
                    # Размер бокса
                    box_size = int(50000 / (distance + 1))
                    box_size = max(10, min(box_size, 80))
                    
                    # Выбор цвета
                    color = red_color if player['health'] < 30 else green_color
                    
                    # Рисуем бокс
                    if 0 <= sx < window_width and 0 <= sy < window_height:
                        cv2.rectangle(
                            canvas,
                            (sx - box_size, sy - box_size),
                            (sx + box_size, sy + box_size),
                            color, 2
                        )
                        
                        # Health bar
                        bar_height = box_size * 2
                        health_height = int(bar_height * player['health'] / 100)
                        
                        cv2.rectangle(
                            canvas,
                            (sx - box_size - 5, sy - box_size),
                            (sx - box_size - 2, sy - box_size + bar_height),
                            (100, 100, 100), 1
                        )
                        cv2.rectangle(
                            canvas,
                            (sx - box_size - 5, sy - box_size + (bar_height - health_height)),
                            (sx - box_size - 2, sy - box_size + bar_height),
                            color, -1
                        )
                        
                        # Имя и дистанция
                        text = f"{player['name']} [{int(distance)}m]"
                        cv2.putText(
                            canvas, text,
                            (sx - box_size, sy - box_size - 5),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, white_color, 1
                        )
                        
                        # HP
                        hp_text = f"HP: {int(player['health'])}%"
                        cv2.putText(
                            canvas, hp_text,
                            (sx - box_size, sy + box_size + 15),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, white_color, 1
                        )
            
            # FPS и статистика
            frame_count += 1
            if time.time() - last_time >= 1.0:
                fps = frame_count
                frame_count = 0
                last_time = time.time()
            
            cv2.putText(canvas, f"FPS: {fps}", (10, 25),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1)
            cv2.putText(canvas, f"Players: {len(players)}", (10, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1)
            cv2.putText(canvas, "Press 'Q' to exit", (10, 75),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
            
            # Показываем окно
            cv2.imshow(window_name, canvas)
            
            # Выход по клавише Q
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                print("[*] Выход по нажатию 'Q'")
                break
            
            # Выход по END
            if keyboard.is_pressed('end'):
                print("[*] Выход по нажатию 'END'")
                break
        
        cv2.destroyAllWindows()


# Альтернативный вариант: рисуем прямо на рабочем столе
class DesktopESP:
    """ESP прямо на рабочем столе через GDI"""
    
    def __init__(self):
        self.esp = ExternalESPOffsets()
        self.running = True
        self.screen_width = win32api.GetSystemMetrics(0)
        self.screen_height = win32api.GetSystemMetrics(1)
        
    def draw_on_desktop(self):
        """Рисуем ESP прямо на экране"""
        # Получаем контекст устройства всего экрана
        hdc = win32gui.GetDC(0)  # 0 = весь экран
        
        # Создаем кисти
        green_pen = win32gui.CreatePen(win32con.PS_SOLID, 2, win32api.RGB(0, 255, 0))
        red_pen = win32gui.CreatePen(win32con.PS_SOLID, 2, win32api.RGB(255, 0, 0))
        white_brush = win32gui.GetStockObject(win32con.WHITE_BRUSH)
        
        # Получаем игроков
        players = self.esp.get_players()
        
        for player in players:
            screen_pos = self.esp.world_to_screen(
                player['position'],
                self.screen_width,
                self.screen_height
            )
            
            if screen_pos:
                x, y = screen_pos
                
                # Выбираем цвет
                pen = red_pen if player['health'] < 30 else green_pen
                win32gui.SelectObject(hdc, pen)
                
                # Рисуем прицел (крестик)
                size = 20
                win32gui.MoveToEx(hdc, x - size, y)
                win32gui.LineTo(hdc, x + size, y)
                win32gui.MoveToEx(hdc, x, y - size)
                win32gui.LineTo(hdc, x, y + size)
                
                # Рисуем круг
                win32gui.Ellipse(hdc, x-15, y-15, x+15, y+15)
                
                # Текст
                win32gui.SetBkMode(hdc, win32con.TRANSPARENT)
                win32gui.SetTextColor(hdc, win32api.RGB(0, 255, 0))
                text = f"HP:{int(player['health'])}%"
                win32gui.TextOut(hdc, x + 20, y - 10, text)
        
        # Очистка
        win32gui.DeleteObject(green_pen)
        win32gui.DeleteObject(red_pen)
        win32gui.ReleaseDC(0, hdc)
        
        # Перерисовываем через 10мс
        if self.running:
            win32gui.InvalidateRect(0, None, True)
    
    def run(self):
        """Запуск"""
        print("[*] ESP на рабочем столе")
        print("[*] Нажмите END для выхода")
        
        while self.running:
            if keyboard.is_pressed('end'):
                break
            
            self.draw_on_desktop()
            time.sleep(0.01)


if __name__ == "__main__":
    print("="*60)
    print("GTA 5 RAGE MP - EXTERNAL ESP")
    print("="*60)
    
    # Проверка прав администратора
    def is_admin():
        try:
            return ctypes.windll.shell32.IsUserAnAdmin()
        except:
            return False
    
    if not is_admin():
        print("[-] Требуются права администратора!")
        print("[*] Перезапуск с правами администратора...")
        ctypes.windll.shell32.ShellExecuteW(
            None, "runas", sys.executable, " ".join(sys.argv), None, 1
        )
        sys.exit()
    
    print("\nВыберите режим отображения:")
    print("1. OpenCV окно (рекомендуется)")
    print("2. Рисование прямо на экране (может мерцать)")
    
    choice = input("\nВаш выбор (1 или 2): ").strip()
    
    if choice == "1":
        overlay = SimpleESPOverlay()
        overlay.run()
    elif choice == "2":
        desktop = DesktopESP()
        desktop.run()
    else:
        print("Неверный выбор!")
    
    input("\nНажмите Enter для выхода...")
