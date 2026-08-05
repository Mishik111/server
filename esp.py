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
import math
import ctypes
import sys
import struct
import psutil

# ============================================
# АКТУАЛЬНЫЕ ОФФСЕТЫ RAGE MP
# ============================================
class Offsets:
    WORLD = 0x25B14B0
    
    class Ped:
        HEALTH = 0x280
        MAX_HEALTH = 0x284
        ARMOR = 0x150C
        POSITION = 0x90
        ROTATION = 0xD4
        PLAYER_INFO = 0x10C8
    
    class Replay:
        PED_INTERFACE = 0x18
        PED_LIST = 0x100
        PED_COUNT = 0x108
    
    class Viewport:
        VIEW_MATRIX = 0x24C


# ============================================
# ЧТЕНИЕ ПАМЯТИ GTA 5 (ИСПРАВЛЕНО)
# ============================================
class GTA5Memory:
    def __init__(self):
        self.pm = None
        self.game_base = None
        self.process_name = "GTA5.exe"
        self.process_id = None
        
    def find_process(self):
        """Поиск процесса GTA5.exe"""
        print(f"[*] Поиск процесса {self.process_name}...")
        
        for proc in psutil.process_iter(['pid', 'name']):
            try:
                if proc.info['name'].lower() == 'gta5.exe':
                    self.process_id = proc.info['pid']
                    print(f"[+] Найден процесс: PID={self.process_id}")
                    return True
            except:
                pass
        
        print(f"[-] Процесс {self.process_name} не найден!")
        print("[*] Убедитесь, что GTA 5 запущена через RAGE MP")
        return False
    
    def attach(self):
        """Подключение к процессу"""
        if not self.find_process():
            return False
        
        try:
            print(f"[*] Подключение к PID {self.process_id}...")
            self.pm = pymem.Pymem()
            self.pm.open_process_from_id(self.process_id)
            
            # Ищем базовый адрес GTA5.exe
            print("[*] Поиск базового адреса GTA5.exe...")
            
            for module in self.pm.list_modules():
                if module.name.lower() == 'gta5.exe':
                    self.game_base = module.lpBaseOfDll
                    print(f"[+] GTA5.exe base: {hex(self.game_base)}")
                    print(f"[+] Размер: {module.SizeOfImage} bytes")
                    return True
            
            print("[-] Модуль GTA5.exe не найден в процессе!")
            
            # Пробуем найти любой модуль
            print("\n[*] Список всех модулей:")
            for module in self.pm.list_modules()[:20]:
                print(f"    {module.name} @ {hex(module.lpBaseOfDll)}")
            
            return False
            
        except Exception as e:
            print(f"[-] Ошибка подключения: {e}")
            return False
    
    def read_int(self, addr):
        try: return self.pm.read_int(addr)
        except: return 0
    
    def read_longlong(self, addr):
        try: return self.pm.read_longlong(addr)
        except: return 0
    
    def read_float(self, addr):
        try: return self.pm.read_float(addr)
        except: return 0.0
    
    def read_bytes(self, addr, size):
        try: return self.pm.read_bytes(addr, size)
        except: return b'\x00' * size
    
    def read_vec3(self, addr):
        try:
            data = self.read_bytes(addr, 12)
            return struct.unpack('fff', data)
        except:
            return (0, 0, 0)
    
    def get_view_matrix(self):
        try:
            viewport_ptr = self.read_longlong(self.game_base + 0x201DBA0)
            if not viewport_ptr:
                return None
            
            matrix_addr = viewport_ptr + Offsets.Viewport.VIEW_MATRIX
            data = self.read_bytes(matrix_addr, 64)
            return list(struct.unpack('16f', data))
        except:
            return None
    
    def world_to_screen(self, world_pos, screen_width, screen_height):
        vm = self.get_view_matrix()
        if not vm:
            return None
        
        x = world_pos[0] * vm[0] + world_pos[1] * vm[1] + world_pos[2] * vm[2] + vm[3]
        y = world_pos[0] * vm[4] + world_pos[1] * vm[5] + world_pos[2] * vm[6] + vm[7]
        w = world_pos[0] * vm[12] + world_pos[1] * vm[13] + world_pos[2] * vm[14] + vm[15]
        
        if w < 0.001:
            return None
        
        inv_w = 1.0 / w
        screen_x = (x * inv_w + 1.0) * screen_width * 0.5
        screen_y = (1.0 - y * inv_w) * screen_height * 0.5
        
        return (int(screen_x), int(screen_y))
    
    def get_local_player_ped(self):
        try:
            world_ptr = self.read_longlong(self.game_base + Offsets.WORLD)
            if not world_ptr:
                return 0
            
            local_player = self.read_longlong(world_ptr + 0x8)
            if not local_player:
                return 0
            
            ped = self.read_longlong(local_player + 0x30)
            return ped
        except:
            return 0
    
    def get_players(self):
        players = []
        
        try:
            world_ptr = self.read_longlong(self.game_base + Offsets.WORLD)
            if not world_ptr:
                return players
            
            local_ped = self.get_local_player_ped()
            
            for i in range(32):
                try:
                    player_info = self.read_longlong(world_ptr + (0x10C8 + (i * 0x8)))
                    if not player_info:
                        continue
                    
                    ped = self.read_longlong(player_info + 0x30)
                    if not ped or ped == local_ped:
                        continue
                    
                    health = self.read_float(ped + Offsets.Ped.HEALTH)
                    pos = self.read_vec3(ped + Offsets.Ped.POSITION)
                    
                    if health > 0 and health <= 200:
                        players.append({
                            'ped': ped,
                            'health': health,
                            'position': pos,
                            'name': f"Player_{i}"
                        })
                except:
                    continue
        except:
            pass
        
        return players


# ============================================
# ESP ОВЕРЛЕЙ
# ============================================
class ESPOverlay:
    def __init__(self):
        self.memory = GTA5Memory()
        self.window_name = "GTA5_ESP_Overlay"
        self.hwnd = None
        self.screen_width = win32api.GetSystemMetrics(0)
        self.screen_height = win32api.GetSystemMetrics(1)
        self.running = True
        
    def create_window(self):
        wc = win32gui.WNDCLASS()
        wc.lpfnWndProc = self.wnd_proc
        wc.hInstance = win32api.GetModuleHandle(None)
        wc.lpszClassName = self.window_name
        
        class_atom = win32gui.RegisterClass(wc)
        
        ex_style = (win32con.WS_EX_LAYERED |
                   win32con.WS_EX_TRANSPARENT |
                   win32con.WS_EX_TOPMOST |
                   win32con.WS_EX_TOOLWINDOW)
        
        self.hwnd = win32gui.CreateWindowEx(
            ex_style, class_atom, self.window_name,
            win32con.WS_POPUP,
            0, 0, self.screen_width, self.screen_height,
            None, None, wc.hInstance, None
        )
        
        win32gui.SetLayeredWindowAttributes(
            self.hwnd, 0x000000, 0, win32con.LWA_COLORKEY
        )
        
        win32gui.ShowWindow(self.hwnd, win32con.SW_SHOW)
        print(f"[+] Оверлей создан")
    
    def wnd_proc(self, hwnd, msg, wparam, lparam):
        if msg == win32con.WM_DESTROY:
            self.running = False
        return win32gui.DefWindowProc(hwnd, msg, wparam, lparam)
    
    def draw_esp(self):
        hdc = win32gui.GetDC(self.hwnd)
        mem_dc = win32gui.CreateCompatibleDC(hdc)
        bitmap = win32gui.CreateCompatibleBitmap(hdc, self.screen_width, self.screen_height)
        old_bmp = win32gui.SelectObject(mem_dc, bitmap)
        
        # Заливаем прозрачным
        brush = win32gui.GetStockObject(win32con.BLACK_BRUSH)
        win32gui.FillRect(mem_dc, (0, 0, self.screen_width, self.screen_height), brush)
        
        win32gui.SetBkMode(mem_dc, win32con.TRANSPARENT)
        
        # Получаем игроков
        local_ped = self.memory.get_local_player_ped()
        local_pos = (0, 0, 0)
        if local_ped:
            local_pos = self.memory.read_vec3(local_ped + Offsets.Ped.POSITION)
        
        players = self.memory.get_players()
        
        # Кисти
        green_pen = win32gui.CreatePen(win32con.PS_SOLID, 2, win32api.RGB(0, 255, 0))
        red_pen = win32gui.CreatePen(win32con.PS_SOLID, 2, win32api.RGB(255, 0, 0))
        
        for player in players:
            screen_pos = self.memory.world_to_screen(
                player['position'],
                self.screen_width,
                self.screen_height
            )
            
            if screen_pos:
                x, y = screen_pos
                
                distance = math.sqrt(
                    (player['position'][0] - local_pos[0])**2 +
                    (player['position'][1] - local_pos[1])**2 +
                    (player['position'][2] - local_pos[2])**2
                ) if local_pos != (0, 0, 0) else 0
                
                box_size = int(30000 / (distance + 1))
                box_size = max(15, min(box_size, 80))
                
                pen = red_pen if player['health'] < 30 else green_pen
                color = win32api.RGB(255, 0, 0) if player['health'] < 30 else win32api.RGB(0, 255, 0)
                
                win32gui.SelectObject(mem_dc, pen)
                win32gui.Rectangle(mem_dc, 
                    x - box_size, y - box_size,
                    x + box_size, y + box_size)
                
                # Health bar
                bar_width = 4
                bar_height = box_size * 2
                health_height = int(bar_height * (player['health'] / 200.0))
                
                hp_brush = win32gui.CreateSolidBrush(color)
                win32gui.FillRect(mem_dc,
                    (x - box_size - bar_width - 2,
                     y + box_size - health_height,
                     x - box_size - 2,
                     y + box_size), hp_brush)
                win32gui.DeleteObject(hp_brush)
                
                win32gui.SetTextColor(mem_dc, win32api.RGB(255, 255, 255))
                info = f"HP:{player['health']:.0f}% [{distance:.0f}m]"
                win32gui.TextOut(mem_dc, x - box_size, y + box_size + 5, info)
        
        # Статистика
        win32gui.SetTextColor(mem_dc, win32api.RGB(0, 255, 255))
        win32gui.TextOut(mem_dc, 10, 10, f"Players: {len(players)} | END to exit")
        
        win32gui.DeleteObject(green_pen)
        win32gui.DeleteObject(red_pen)
        
        win32gui.BitBlt(hdc, 0, 0, self.screen_width, self.screen_height,
                       mem_dc, 0, 0, win32con.SRCCOPY)
        
        win32gui.SelectObject(mem_dc, old_bmp)
        win32gui.DeleteObject(bitmap)
        win32gui.DeleteDC(mem_dc)
        win32gui.ReleaseDC(self.hwnd, hdc)
    
    def run(self):
        print("\n[*] ESP запущен! Нажмите END для выхода")
        
        while self.running:
            if win32api.GetAsyncKeyState(win32con.VK_END) & 0x8000:
                break
            
            self.draw_esp()
            time.sleep(0.016)
            win32gui.PumpWaitingMessages()
        
        win32gui.DestroyWindow(self.hwnd)


# ============================================
# ЗАПУСК
# ============================================
if __name__ == "__main__":
    def is_admin():
        try: return ctypes.windll.shell32.IsUserAnAdmin()
        except: return False
    
    if not is_admin():
        ctypes.windll.shell32.ShellExecuteW(
            None, "runas", sys.executable, __file__, None, 1
        )
        sys.exit()
    
    print("="*60)
    print("GTA 5 ESP - RAGE MP")
    print("="*60)
    
    overlay = ESPOverlay()
    
    if not overlay.memory.attach():
        print("\n[-] Не удалось подключиться к игре!")
        print("[*] Проверьте:")
        print("    1. GTA 5 запущена через RAGE MP")
        print("    2. Вы зашли на сервер")
        print("    3. Процесс называется GTA5.exe (проверьте в диспетчере задач)")
        input("\nНажмите Enter для выхода...")
        sys.exit()
    
    overlay.create_window()
    overlay.run()
    
    input("\nНажмите Enter для выхода...")
