/* eslint-disable react-refresh/only-export-components */
import { createContext, ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";

export type Language = "en" | "es" | "zh";

export const LANGUAGE_STORAGE_KEY = "app.language";

export const LANGUAGES: { code: Language; label: string; shortLabel: string; nativeName: string }[] = [
  { code: "en", label: "English", shortLabel: "EN", nativeName: "English" },
  { code: "es", label: "Español", shortLabel: "ES", nativeName: "Español" },
  { code: "zh", label: "中文", shortLabel: "中文", nativeName: "中文" },
];

type RuntimeLanguage = Exclude<Language, "en">;
type TranslationTable = Record<string, Partial<Record<RuntimeLanguage, string>>>;

const TEXT: TranslationTable = {
  "Cloud data is offline. Changes are saved on this computer and will sync when the connection returns.": {
    es: "Los datos en la nube están sin conexión. Los cambios se guardan en este equipo y se sincronizarán cuando vuelva la conexión.",
    zh: "云端数据当前离线。修改会先保存在这台电脑上，连接恢复后自动同步。",
  },
  "Cloud-ready product image catalog with SKU naming, directory index, and image role lookup.": {
    es: "Catálogo de imágenes de producto con SKU, carpetas y tipo de imagen.",
    zh: "按 SKU、目录和图片类型管理商品图片。",
  },
  "Upload pictures": { es: "Subir imágenes", zh: "上传图片" },
  "Filename must be uppercase JPG:": { es: "El archivo debe ser JPG en mayúsculas:", zh: "文件名必须大写，格式为 JPG：" },
  "Codes: F front, B back, D1/D2 detail, MF/MB/MX model, S1/S2 SHEIN.": {
    es: "Códigos: F frente, B espalda, D1/D2 detalle, MF/MB/MX modelo, S1/S2 SHEIN.",
    zh: "代码：F 正面，B 背面，D1/D2 细节，MF/MB/MX 模特，S1/S2 SHEIN。",
  },
  "AWS key preview: women/category/fine-category/model/sku/file.jpg": {
    es: "Ruta S3: women/category/fine-category/model/sku/file.jpg",
    zh: "S3 路径：women/category/fine-category/model/sku/file.jpg",
  },
  "Directories": { es: "Carpetas", zh: "目录" },
  "Product matched": { es: "Producto vinculado", zh: "已匹配产品" },
  "Needs product link": { es: "Sin producto vinculado", zh: "待匹配产品" },
  "Directory index": { es: "Índice de carpetas", zh: "目录索引" },
  "S3-ready lookup": { es: "Búsqueda S3", zh: "S3 索引" },
  "Directory": { es: "Carpeta", zh: "目录" },
  "Roles": { es: "Tipos", zh: "类型" },
  "Thumbnail": { es: "Miniatura", zh: "缩略图" },
  "SKU / Model": { es: "SKU / Modelo", zh: "SKU / 型号" },
  "Uploaded": { es: "Subido", zh: "上传时间" },
  "Search by SKU, model, code, filename, role or directory...": {
    es: "Buscar por SKU, modelo, código, archivo, tipo o carpeta...",
    zh: "按 SKU、型号、代码、文件名、类型或目录搜索...",
  },
  "No matching pictures": { es: "Sin imágenes coincidentes", zh: "没有匹配图片" },
  "Upload JPG files named like P001BLK_F.JPG or P001BLK-F.JPG to populate the catalog.": {
    es: "Sube JPG con nombres como P001BLK_F.JPG o P001BLK-F.JPG.",
    zh: "上传类似 P001BLK_F.JPG 或 P001BLK-F.JPG 的 JPG 图片。",
  },
  "Picture replaced": { es: "Imagen reemplazada", zh: "图片已替换" },
  "Wrong filename format": { es: "Formato de archivo incorrecto", zh: "文件名格式错误" },
  "Storage full": { es: "Almacenamiento lleno", zh: "存储空间已满" },
  "Browser storage is full. Remove some pictures and try again.": {
    es: "El almacenamiento local está lleno. Elimina algunas imágenes e inténtalo de nuevo.",
    zh: "本地存储已满。请删除部分图片后重试。",
  },
  "Failed to upload file": { es: "No se pudo subir el archivo", zh: "文件上传失败" },
  "Replace": { es: "Reemplazar", zh: "替换" },
  "front": { es: "frente", zh: "正面" },
  "back": { es: "espalda", zh: "背面" },
  "detail": { es: "detalle", zh: "细节" },
  "model front": { es: "modelo frente", zh: "模特正面" },
  "model back": { es: "modelo espalda", zh: "模特背面" },
  "model extra": { es: "modelo extra", zh: "模特补充" },
  "shein": { es: "SHEIN", zh: "SHEIN" },
  "other": { es: "otro", zh: "其他" },
  "Classified invoice database for B2B, B2C, no-invoice customers, tax profiles, preview, download, and draft editing.": {
    es: "Facturas clasificadas por B2B, B2C, sin factura, impuestos, vista previa, descarga y edición.",
    zh: "按 B2B、B2C、无发票、税务、预览、下载和草稿编辑管理发票。",
  },
  "No invoice results": { es: "Sin resultados de facturas", zh: "没有发票结果" },
  "Invoices will appear here after orders are created.": {
    es: "Las facturas aparecerán aquí cuando se creen pedidos.",
    zh: "创建订单后，发票会显示在这里。",
  },
  "No SKU selected": { es: "Ningún SKU seleccionado", zh: "未选择 SKU" },
  "Select a SKU from the table.": { es: "Selecciona un SKU de la tabla.", zh: "请从表格中选择一个 SKU。" },
  "Search by order, SKU, reason...": { es: "Buscar por pedido, SKU o motivo...", zh: "按订单、SKU、原因搜索..." },
  "Product": { es: "Producto", zh: "产品" },
  "Location": { es: "Ubicación", zh: "位置" },
  "Time": { es: "Hora", zh: "时间" },
  "Operation": { es: "Operación", zh: "操作" },
  "Reason": { es: "Motivo", zh: "原因" },
  "Note": { es: "Nota", zh: "备注" },
  "Search by model, SKU, name, colour, size, warehouse location...": {
    es: "Buscar por modelo, SKU, nombre, color, talla o ubicación...",
    zh: "按型号、SKU、名称、颜色、尺码或仓库位置搜索...",
  },
  "Main Warehouse": { es: "Almacén principal", zh: "主仓库" },
  "Shop Floor": { es: "Sala de ventas", zh: "门店区" },
  "Returns Area": { es: "Zona de devoluciones", zh: "退货区" },
  "Cancel restore": { es: "Restauración por cancelación", zh: "取消恢复" },
  "Initial import": { es: "Importación inicial", zh: "初始导入" },
  "Search by invoice, customer, VAT, tax profile or status...": {
    es: "Buscar por factura, cliente, IVA, perfil fiscal o estado...",
    zh: "按发票、客户、税号、税务类型或状态搜索...",
  },
  "B2B invoice": { es: "Factura B2B", zh: "B2B 发票" },
  "B2C receipt": { es: "Recibo B2C", zh: "B2C 收据" },
  "All invoices": { es: "Todas las facturas", zh: "全部发票" },
  "Draft": { es: "Borrador", zh: "草稿" },
  "No invoice": { es: "Sin factura", zh: "无发票" },
  "Proforma": { es: "Proforma", zh: "形式发票" },
  "B2B Spain": { es: "B2B España", zh: "西班牙 B2B" },
  "B2B EU VAT": { es: "B2B IVA UE", zh: "欧盟 VAT B2B" },
  "B2B International": { es: "B2B internacional", zh: "国际 B2B" },
  "Issued": { es: "Emitidas", zh: "已开具" },
  "Editable": { es: "Editable", zh: "可编辑" },
  "Draft / editable": { es: "Borrador / editable", zh: "草稿 / 可编辑" },
  "Outstanding": { es: "Pendiente", zh: "未收款" },
  "Tax profile": { es: "Perfil fiscal", zh: "税务类型" },
  "Invoice updated": { es: "Factura actualizada", zh: "发票已更新" },
  "Could not generate PDF": { es: "No se pudo generar el PDF", zh: "无法生成 PDF" },
  "Issued paid invoices are locked": { es: "Las facturas emitidas y pagadas están bloqueadas", zh: "已开具且已付款的发票已锁定" },
  "Pay": { es: "Pagar", zh: "付款" },
  "Preview": { es: "Vista previa", zh: "预览" },
  "Print": { es: "Imprimir", zh: "打印" },
  "PDF": { es: "PDF", zh: "PDF" },
  "Edit invoice": { es: "Editar factura", zh: "编辑发票" },
  "Download PDF": { es: "Descargar PDF", zh: "下载 PDF" },
  "Yes": { es: "Sí", zh: "是" },
  "No": { es: "No", zh: "否" },
  "Search": { es: "Buscar", zh: "搜索" },
  "Model": { es: "Modelo", zh: "型号" },
  "or": { es: "o", zh: "或" },
  "Expected PREFIX_CODE.JPG or SKU-CODE.JPG (e.g. P001BLK_F.JPG, P001BLK-D1.JPG)": {
    es: "Formato esperado: PREFIX_CODE.JPG o SKU-CODE.JPG (ej. P001BLK_F.JPG, P001BLK-D1.JPG)",
    zh: "期望格式：PREFIX_CODE.JPG 或 SKU-CODE.JPG（例如 P001BLK_F.JPG、P001BLK-D1.JPG）",
  },
  "Expected PREFIX_CODE.JPG or SKU-CODE.JPG (e.g. P001BLK_F.JPG)": {
    es: "Formato esperado: PREFIX_CODE.JPG o SKU-CODE.JPG (ej. P001BLK_F.JPG)",
    zh: "期望格式：PREFIX_CODE.JPG 或 SKU-CODE.JPG（例如 P001BLK_F.JPG）",
  },
  "English": { es: "Inglés", zh: "英文" },
  "Español": { es: "Español", zh: "西班牙语" },
  "中文": { es: "Chino", zh: "中文" },
  "Language": { es: "Idioma", zh: "语言" },
  "Languages": { es: "Idiomas", zh: "语言" },
  "Change language": { es: "Cambiar idioma", zh: "切换语言" },
  "Change language from": { es: "Cambiar idioma de", zh: "将语言从" },
  "to": { es: "a", zh: "改为" },
  "Confirm language change?": { es: "¿Confirmar cambio de idioma?", zh: "确认切换语言？" },
  "Language updated": { es: "Idioma actualizado", zh: "语言已更新" },
  "Select language": { es: "Seleccionar idioma", zh: "选择语言" },
  "Currently active:": { es: "Activo actualmente:", zh: "当前启用：" },
  "No changes": { es: "Sin cambios", zh: "没有更改" },
  "Apply": { es: "Aplicar", zh: "应用" },
  "Revert": { es: "Revertir", zh: "还原" },
  "Confirm change": { es: "Confirmar cambio", zh: "确认更改" },
  "Cancel": { es: "Cancelar", zh: "取消" },
  "Close": { es: "Cerrar", zh: "关闭" },
  "Back": { es: "Volver", zh: "返回" },
  "Save": { es: "Guardar", zh: "保存" },
  "Add": { es: "Añadir", zh: "添加" },
  "New": { es: "Nuevo", zh: "新建" },
  "Select": { es: "Seleccionar", zh: "选择" },
  "Remove": { es: "Eliminar", zh: "移除" },
  "Delete": { es: "Eliminar", zh: "删除" },
  "Update": { es: "Actualizar", zh: "更新" },
  "Create": { es: "Crear", zh: "创建" },
  "Actions": { es: "Acciones", zh: "操作" },
  "Required": { es: "Obligatorio", zh: "必填" },
  "Optional": { es: "Opcional", zh: "可选" },
  "Open menu": { es: "Abrir menú", zh: "打开菜单" },
  "Close menu": { es: "Cerrar menú", zh: "关闭菜单" },
  "Main menu": { es: "Menú principal", zh: "主菜单" },
  "Choose a section": { es: "Elige una sección", zh: "选择一个页面" },
  "Sign in": { es: "Iniciar sesión", zh: "登录" },
  "Sign out": { es: "Cerrar sesión", zh: "退出登录" },
  "Sign out?": { es: "¿Cerrar sesión?", zh: "确认退出？" },
  "Username": { es: "Usuario", zh: "用户名" },
  "Password": { es: "Contraseña", zh: "密码" },
  "dev or ops": { es: "dev u ops", zh: "dev 或 ops" },
  "Invalid credentials": { es: "Credenciales no válidas", zh: "账号或密码无效" },
  "Enter username and password": { es: "Introduce usuario y contraseña", zh: "请输入用户名和密码" },
  "Two roles · Developer · Operator": { es: "Dos roles · Desarrollador · Operador", zh: "两种角色 · 开发者 · 操作员" },
  "Two roles 路 Developer 路 Operator": { es: "Dos roles · Desarrollador · Operador", zh: "两种角色 · 开发者 · 操作员" },
  "Developer": { es: "Desarrollador", zh: "开发者" },
  "Operator": { es: "Operador", zh: "操作员" },
  "developer": { es: "desarrollador", zh: "开发者" },
  "operator": { es: "operador", zh: "操作员" },
  "Account": { es: "Cuenta", zh: "账号" },
  "Role": { es: "Rol", zh: "角色" },
  "Access": { es: "Acceso", zh: "访问权限" },
  "Access · Accounts and passwords": { es: "Acceso · Cuentas y contraseñas", zh: "访问权限 · 账号和密码" },
  "Accounts and passwords": { es: "Cuentas y contraseñas", zh: "账号和密码" },
  "Developers": { es: "Desarrolladores", zh: "开发者" },
  "Operators": { es: "Operadores", zh: "操作员" },
  "Full access": { es: "Acceso completo", zh: "完整权限" },
  "New operator": { es: "Nuevo operador", zh: "新建操作员" },
  "Create operator": { es: "Crear operador", zh: "创建操作员" },
  "Change password": { es: "Cambiar contraseña", zh: "修改密码" },
  "Update password": { es: "Actualizar contraseña", zh: "更新密码" },
  "New password": { es: "Nueva contraseña", zh: "新密码" },
  "Confirm password": { es: "Confirmar contraseña", zh: "确认密码" },
  "Password must be at least 4 characters": { es: "La contraseña debe tener al menos 4 caracteres", zh: "密码至少需要 4 个字符" },
  "Passwords do not match": { es: "Las contraseñas no coinciden", zh: "两次密码不一致" },
  "Account not found": { es: "Cuenta no encontrada", zh: "账号未找到" },
  "No operator accounts yet.": { es: "Todavía no hay cuentas de operador.", zh: "还没有操作员账号。" },
  "(you)": { es: "(tú)", zh: "（你）" },

  "POS": { es: "TPV", zh: "收银台" },
  "Products": { es: "Productos", zh: "产品" },
  "Customers": { es: "Clientes", zh: "客户" },
  "ORDERS": { es: "PEDIDOS", zh: "订单" },
  "Orders": { es: "Pedidos", zh: "订单" },
  "Invoices": { es: "Facturas", zh: "发票" },
  "Sales": { es: "Ventas", zh: "销售" },
  "Images": { es: "Imágenes", zh: "图片" },
  "Inventory": { es: "Inventario", zh: "库存" },
  "Products / Stock": { es: "Productos / Stock", zh: "产品 / 库存" },
  "Stock units": { es: "Unidades en stock", zh: "库存件数" },
  "Inventory cost value": { es: "Valor de coste de inventario", zh: "库存成本价值" },
  "Retail value": { es: "Valor de venta", zh: "零售价值" },
  "Low / out of stock": { es: "Bajo / sin stock", zh: "低库存 / 缺货" },
  "All products": { es: "Todos los productos", zh: "全部商品" },
  "In stock": { es: "Con stock", zh: "有库存" },
  "Low stock": { es: "Stock bajo", zh: "低库存" },
  "Out of stock": { es: "Sin stock", zh: "缺货" },
  "Inventory management": { es: "Gestión de inventario", zh: "库存管理" },
  "Query and update": { es: "Consultar y actualizar", zh: "查询并更新" },
  "Selected SKU": { es: "SKU seleccionado", zh: "已选 SKU" },
  "Current": { es: "Actual", zh: "当前" },
  "Warehouse": { es: "Almacén", zh: "仓库" },
  "Warehouse location": { es: "Ubicación de almacén", zh: "仓库位置" },
  "Operation type": { es: "Tipo de operación", zh: "操作类型" },
  "Receive stock": { es: "Entrada", zh: "入库" },
  "Remove stock": { es: "Salida", zh: "出库" },
  "Stock count": { es: "Inventario físico", zh: "盘点" },
  "Return": { es: "Devolución", zh: "退货" },
  "Correction": { es: "Corrección", zh: "修正" },
  "Transfer location": { es: "Transferir ubicación", zh: "调拨位置" },
  "New stock quantity": { es: "Nueva cantidad de stock", zh: "新库存数量" },
  "Transfer quantity": { es: "Cantidad a transferir", zh: "调拨数量" },
  "Quantity": { es: "Cantidad", zh: "数量" },
  "Reason category": { es: "Categoría de motivo", zh: "原因分类" },
  "Purchase inbound": { es: "Compra entrada", zh: "采购入库" },
  "Supplier arrival": { es: "Llegada de proveedor", zh: "供应商到货" },
  "Customer return": { es: "Devolución de cliente", zh: "客户退货" },
  "Sales outbound": { es: "Salida por venta", zh: "销售出库" },
  "Supplier return": { es: "Devolución a proveedor", zh: "供应商退货" },
  "Stocktake correction": { es: "Corrección de inventario", zh: "盘点修正" },
  "Damaged or lost": { es: "Dañado o perdido", zh: "破损或丢失" },
  "Sample or internal use": { es: "Muestra o uso interno", zh: "样衣或内部使用" },
  "Warehouse transfer": { es: "Transferencia de almacén", zh: "仓库调拨" },
  "Custom reason": { es: "Motivo personalizado", zh: "自定义原因" },
  "Before": { es: "Antes", zh: "原库存" },
  "Change": { es: "Cambio", zh: "变动" },
  "After": { es: "Después", zh: "新库存" },
  "Update inventory": { es: "Actualizar inventario", zh: "更新库存" },
  "Inventory movements": { es: "Movimientos de inventario", zh: "库存流水" },
  "No inventory movements": { es: "Sin movimientos de inventario", zh: "暂无库存流水" },
  "Stock changes will appear here.": { es: "Los cambios de stock aparecerán aquí.", zh: "库存变化会显示在这里。" },
  "No inventory results": { es: "Sin resultados de inventario", zh: "没有库存结果" },
  "Try another SKU, colour, size or location.": { es: "Prueba otro SKU, color, talla o ubicación.", zh: "请尝试其他 SKU、颜色、尺码或位置。" },
  "Inventory updated": { es: "Inventario actualizado", zh: "库存已更新" },
  "Enter a valid quantity": { es: "Introduce una cantidad válida", zh: "请输入有效数量" },
  "Quantity must be greater than 0": { es: "La cantidad debe ser mayor que 0", zh: "数量必须大于 0" },
  "Quantity cannot exceed current stock": { es: "La cantidad no puede superar el stock actual", zh: "数量不能超过当前库存" },
  "Approvals": { es: "Aprobaciones", zh: "审批" },
  "Log": { es: "Registro", zh: "日志" },
  "Settings": { es: "Ajustes", zh: "设置" },
  "Stock": { es: "Stock", zh: "库存" },
  "Transport": { es: "Transporte", zh: "运输" },
  "General": { es: "General", zh: "通用" },
  "General settings": { es: "Ajustes generales", zh: "通用设置" },
  "Configuration for this section will be added here.": { es: "La configuración de esta sección se añadirá aquí.", zh: "此部分的配置稍后添加。" },

  "Customer Care System": { es: "Sistema de Atención al Cliente", zh: "客户管理系统" },
  "Customer": { es: "Cliente", zh: "客户" },
  "Identify customer": { es: "Identificar cliente", zh: "识别客户" },
  "Scan products": { es: "Escanear productos", zh: "扫描产品" },
  "Checkout": { es: "Cobro", zh: "结账" },
  "Document": { es: "Documento", zh: "单据" },
  "Invoice": { es: "Factura", zh: "发票" },
  "INVOICE": { es: "FACTURA", zh: "发票" },
  "PROFORMA": { es: "PROFORMA", zh: "形式发票" },
  "Delivery note": { es: "Albarán", zh: "送货单" },
  "Delivery notes": { es: "Albaranes", zh: "送货单" },
  "NOTE": { es: "ALBARÁN", zh: "送货单" },
  "Receipt": { es: "Recibo", zh: "收据" },
  "No tax": { es: "Sin impuestos", zh: "不含税" },
  "New customer": { es: "Nuevo cliente", zh: "新客户" },
  "Create & select": { es: "Crear y seleccionar", zh: "创建并选择" },
  "Select customer": { es: "Seleccionar cliente", zh: "选择客户" },
  "No customers found.": { es: "No se encontraron clientes.", zh: "未找到客户。" },
  "ID, name, phone, VAT, email…": { es: "ID, nombre, teléfono, NIF/CIF, email…", zh: "ID、姓名、电话、税号、邮箱…" },
  "Search by ID, name, phone, VAT, email…": { es: "Buscar por ID, nombre, teléfono, NIF/CIF, email…", zh: "按 ID、姓名、电话、税号、邮箱搜索…" },
  "Scan or type barcode then press Enter": { es: "Escanea o escribe el código y pulsa Enter", zh: "扫描或输入条码后按回车" },
  "Hardware scanners auto-submit on Enter. Click anywhere else and the field stays focused.": { es: "Los lectores envían automáticamente con Enter. Haz clic en cualquier zona y el campo mantiene el foco.", zh: "扫码枪会在回车时自动提交。点击其他区域后输入框仍保持焦点。" },
  "Cart is empty. Scan a product to begin.": { es: "El carrito está vacío. Escanea un producto para empezar.", zh: "购物车为空。请扫描产品开始。" },
  "Item": { es: "Artículo", zh: "商品" },
  "Qty": { es: "Cant.", zh: "数量" },
  "Disc %": { es: "Dto. %", zh: "折扣 %" },
  "Amount": { es: "Importe", zh: "金额" },
  "Subtotal": { es: "Subtotal", zh: "小计" },
  "VAT": { es: "IVA", zh: "增值税" },
  "Tax": { es: "Impuesto", zh: "税费" },
  "Recargo": { es: "Recargo", zh: "附加税" },
  "Total": { es: "Total", zh: "总计" },
  "Proceed to payment": { es: "Continuar al pago", zh: "去付款" },
  "Clear cart": { es: "Vaciar carrito", zh: "清空购物车" },
  "Sale is saved in the sales database and attached to the customer's record.": { es: "La venta se guarda en la base de datos y queda vinculada al cliente.", zh: "销售记录会保存到销售数据库，并关联到客户档案。" },
  "Selling to": { es: "Vendiendo a", zh: "销售给" },
  "no VAT": { es: "sin IVA", zh: "无税号" },
  "Transport · Add a logistics address to enable": { es: "Transporte · Añade dirección logística para habilitar", zh: "运输 · 添加物流地址后启用" },
  "Collect in store": { es: "Recoger en tienda", zh: "到店自取" },
  "Collect in store · No transport fee": { es: "Recoger en tienda · Sin coste de transporte", zh: "到店自取 · 无运输费" },
  "Select transport method": { es: "Seleccionar método de transporte", zh: "选择运输方式" },
  "Full payment": { es: "Pago completo", zh: "全额付款" },
  "Partial payment": { es: "Pago parcial", zh: "部分付款" },
  "Open order": { es: "Pedido abierto", zh: "挂账订单" },
  "Mark as paid": { es: "Marcar como pagado", zh: "标记为已付款" },
  "Pay part now": { es: "Pagar una parte ahora", zh: "现在支付部分金额" },
  "Pay later": { es: "Pagar más tarde", zh: "稍后付款" },
  "Amount paid now": { es: "Importe pagado ahora", zh: "本次付款金额" },
  "Pending": { es: "Pendiente", zh: "待付" },
  "Method": { es: "Método", zh: "方式" },
  "Card": { es: "Tarjeta", zh: "银行卡" },
  "Cash": { es: "Efectivo", zh: "现金" },
  "Bank transfer": { es: "Transferencia bancaria", zh: "银行转账" },
  "Other": { es: "Otro", zh: "其他" },
  "Confirm order": { es: "Confirmar pedido", zh: "确认订单" },
  "Customer created": { es: "Cliente creado", zh: "客户已创建" },
  "Name is required": { es: "El nombre es obligatorio", zh: "名称为必填项" },
  "Contact phone number is required": { es: "El teléfono de contacto es obligatorio", zh: "联系电话为必填项" },
  "Enter a valid partial amount": { es: "Introduce un importe parcial válido", zh: "请输入有效的部分付款金额" },
  "Partial amount must be less than total": { es: "El importe parcial debe ser menor que el total", zh: "部分付款金额必须小于总额" },
  "Order must have at least one line": { es: "El pedido debe tener al menos una línea", zh: "订单至少需要一行商品" },

  "Products · Inventory": { es: "Productos · Inventario", zh: "产品 · 库存" },
  "New product": { es: "Nuevo producto", zh: "新产品" },
  "Edit product": { es: "Editar producto", zh: "编辑产品" },
  "Add your first product to start selling.": { es: "Añade tu primer producto para empezar a vender.", zh: "添加第一个产品后即可开始销售。" },
  "No products yet": { es: "Todavía no hay productos", zh: "还没有产品" },
  "No rows imported": { es: "No se importaron filas", zh: "没有导入任何行" },
  "Import products from Excel": { es: "Importar productos desde Excel", zh: "从 Excel 导入产品" },
  "Download Excel template": { es: "Descargar plantilla Excel", zh: "下载 Excel 模板" },
  "Import Excel": { es: "Importar Excel", zh: "导入 Excel" },
  "Bulk upload": { es: "Carga masiva", zh: "批量上传" },
  "File name": { es: "Nombre de archivo", zh: "文件名" },
  "Model (P number) *": { es: "Modelo (número P) *", zh: "型号（P 编号）*" },
  "Model is required": { es: "El modelo es obligatorio", zh: "型号为必填项" },
  "Auto-generated, but you can override it. Format: P + sequential number starting at 001.": { es: "Se genera automáticamente, pero puedes modificarlo. Formato: P + número secuencial desde 001.", zh: "自动生成，但可以手动修改。格式：P + 从 001 开始的序号。" },
  "Name *": { es: "Nombre *", zh: "名称 *" },
  "Description is required": { es: "La descripción es obligatoria", zh: "描述为必填项" },
  "Main Category *": { es: "Categoría principal *", zh: "主分类 *" },
  "Category is required": { es: "La categoría es obligatoria", zh: "分类为必填项" },
  "Fine-Category *": { es: "Subcategoría *", zh: "细分类 *" },
  "Fine-Category is required": { es: "La subcategoría es obligatoria", zh: "细分类为必填项" },
  "Category 2 (optional)": { es: "Categoría 2 (opcional)", zh: "分类 2（可选）" },
  "Category 3 (optional)": { es: "Categoría 3 (opcional)", zh: "分类 3（可选）" },
  "B2B Price *": { es: "Precio B2B *", zh: "B2B 价格 *" },
  "B2B Price is required": { es: "El precio B2B es obligatorio", zh: "B2B 价格为必填项" },
  "B2C Price is required": { es: "El precio B2C es obligatorio", zh: "B2C 价格为必填项" },
  "B2C Mark up is required": { es: "El margen B2C es obligatorio", zh: "B2C 加价为必填项" },
  "Composition is required": { es: "La composición es obligatoria", zh: "成分为必填项" },
  "Complete every composition row": { es: "Completa todas las filas de composición", zh: "请补完整每一行成分" },
  "Add material": { es: "Añadir material", zh: "添加材质" },
  "At least one variation is required": { es: "Se requiere al menos una variación", zh: "至少需要一个变体" },
  "Create Variations": { es: "Crear variaciones", zh: "生成变体" },
  "Variations": { es: "Variaciones", zh: "变体" },
  "Sizes": { es: "Tallas", zh: "尺码" },
  "Size": { es: "Talla", zh: "尺码" },
  "Colour": { es: "Color", zh: "颜色" },
  "Colours": { es: "Colores", zh: "颜色" },
  "Colour name": { es: "Nombre del color", zh: "颜色名称" },
  "Colour code": { es: "Código de color", zh: "颜色代码" },
  "No colour found.": { es: "No se encontró ningún color.", zh: "未找到颜色。" },
  "No match": { es: "Sin coincidencias", zh: "无匹配结果" },
  "Select at least one colour and one size": { es: "Selecciona al menos un color y una talla", zh: "请至少选择一种颜色和一个尺码" },
  "Select a size to add": { es: "Seleccionar talla para añadir", zh: "选择要添加的尺码" },
  "SKU (auto)": { es: "SKU (auto)", zh: "SKU（自动）" },
  "Other SKU": { es: "Otro SKU", zh: "其他 SKU" },
  "Quantity *": { es: "Cantidad *", zh: "数量 *" },
  "Pictures": { es: "Fotos", zh: "图片" },
  "Main picture": { es: "Foto principal", zh: "主图" },
  "Pictures per colour": { es: "Fotos por color", zh: "按颜色上传图片" },
  "+ Select from gallery": { es: "+ Seleccionar de galería", zh: "+ 从图库选择" },
  "Select from gallery": { es: "Seleccionar de galería", zh: "从图库选择" },
  "Pick an image previously uploaded in the Images section.": { es: "Elige una imagen subida previamente en la sección Imágenes.", zh: "从“图片”页面已上传的图片中选择。" },
  "Search by prefix or filename": { es: "Buscar por prefijo o nombre de archivo", zh: "按前缀或文件名搜索" },
  "Gallery is empty. Upload images in the Images section.": { es: "La galería está vacía. Sube imágenes en la sección Imágenes.", zh: "图库为空。请先在“图片”页面上传。" },
  "No matches.": { es: "Sin coincidencias.", zh: "无匹配结果。" },
  "Add colours in the Variations panel to upload per-colour images.": { es: "Añade colores en el panel Variaciones para subir imágenes por color.", zh: "请先在“变体”面板添加颜色，再按颜色上传图片。" },
  "Add sizes in the Variations panel to enter measurements.": { es: "Añade tallas en el panel Variaciones para introducir medidas.", zh: "请先在“变体”面板添加尺码，再填写尺寸。" },
  "Weight (g)": { es: "Peso (g)", zh: "重量（克）" },
  "Estimated": { es: "Estimado", zh: "估算" },
  "Manual": { es: "Manual", zh: "手动" },
  "SHEIN Toggle": { es: "Activar SHEIN", zh: "启用 SHEIN" },
  "SHEIN Name": { es: "Nombre SHEIN", zh: "SHEIN 名称" },
  "SHEIN Price": { es: "Precio SHEIN", zh: "SHEIN 价格" },
  "SHEIN Description": { es: "Descripción SHEIN", zh: "SHEIN 描述" },
  "Manufacturer": { es: "Fabricante", zh: "制造商" },
  "Order ID": { es: "ID de pedido", zh: "订单 ID" },
  "Product saved": { es: "Producto guardado", zh: "产品已保存" },
  "Failed to save product": { es: "No se pudo guardar el producto", zh: "保存产品失败" },

  "Customers · CRM": { es: "Clientes · CRM", zh: "客户 · CRM" },
  "No customers yet": { es: "Todavía no hay clientes", zh: "还没有客户" },
  "Create the first customer profile.": { es: "Crea el primer perfil de cliente.", zh: "创建第一个客户档案。" },
  "Name": { es: "Nombre", zh: "名称" },
  "Surname": { es: "Apellidos", zh: "姓氏" },
  "Phone": { es: "Teléfono", zh: "电话" },
  "Contact phone": { es: "Teléfono de contacto", zh: "联系电话" },
  "Country code": { es: "Código de país", zh: "国家区号" },
  "Email": { es: "Email", zh: "邮箱" },
  "Address": { es: "Dirección", zh: "地址" },
  "Fiscal address": { es: "Dirección fiscal", zh: "财务地址" },
  "Logistics address": { es: "Dirección logística", zh: "物流地址" },
  "Copy from logistics": { es: "Copiar desde logística", zh: "从物流地址复制" },
  "Address line 1": { es: "Dirección línea 1", zh: "地址第 1 行" },
  "Address line 2": { es: "Dirección línea 2", zh: "地址第 2 行" },
  "Additional info": { es: "Información adicional", zh: "附加信息" },
  "Province": { es: "Provincia", zh: "省/州" },
  "Postal code": { es: "Código postal", zh: "邮编" },
  "Country": { es: "País", zh: "国家" },
  "Client type": { es: "Tipo de cliente", zh: "客户类型" },
  "Business type": { es: "Tipo de empresa", zh: "企业类型" },
  "Business name": { es: "Razón social", zh: "公司名称" },
  "EU VAT / CIF": { es: "IVA UE / CIF", zh: "欧盟 VAT / CIF" },
  "VAT number": { es: "NIF/CIF", zh: "税号" },
  "Tax rate (%)": { es: "Tipo impositivo (%)", zh: "税率 (%)" },
  "Customer removed": { es: "Cliente eliminado", zh: "客户已删除" },

  "Invoice history": { es: "Historial de facturas", zh: "发票历史" },
  "No invoices yet.": { es: "Todavía no hay facturas.", zh: "还没有发票。" },
  "Generate an invoice from Point of sale to see it here.": { es: "Genera una factura desde el TPV para verla aquí.", zh: "从收银台生成发票后会显示在这里。" },
  "No sales yet": { es: "Todavía no hay ventas", zh: "还没有销售记录" },
  "Payment details": { es: "Detalles de pago", zh: "付款信息" },
  "Payment date": { es: "Fecha de pago", zh: "付款日期" },
  "Bank / card ref": { es: "Ref. banco/tarjeta", zh: "银行/卡交易号" },
  "Amount exceeds pending": { es: "El importe supera lo pendiente", zh: "金额超过待付金额" },
  "Enter a valid amount": { es: "Introduce un importe válido", zh: "请输入有效金额" },
  "Marked as paid": { es: "Marcado como pagado", zh: "已标记为付款" },
  "Already paid": { es: "Ya pagado", zh: "已付款" },
  "Cancel sale": { es: "Cancelar venta", zh: "取消销售" },
  "Delete draft": { es: "Eliminar borrador", zh: "删除草稿" },
  "Delivery-note clients": { es: "Clientes de albarán", zh: "送货单客户" },
  "Invoice clients": { es: "Clientes de factura", zh: "发票客户" },

  "Image gallery": { es: "Galería de imágenes", zh: "图片库" },
  "No pictures yet": { es: "Todavía no hay fotos", zh: "还没有图片" },
  "Double-click to preview": { es: "Doble clic para previsualizar", zh: "双击预览" },
  "Missing picture": { es: "Falta imagen", zh: "缺少图片" },
  "Filename must be ALL CAPS, JPG format:": { es: "El nombre debe estar en MAYÚSCULAS y formato JPG:", zh: "文件名必须全大写，且为 JPG 格式：" },
  "Expected XXX_Y.JPG (e.g. P001BLK_F.JPG)": { es: "Esperado XXX_Y.JPG (ej. P001BLK_F.JPG)", zh: "期望格式 XXX_Y.JPG（如 P001BLK_F.JPG）" },
  "Expected XXX_Y.JPG (e.g. P001BLK_F.JPG, P001BLK_D1.JPG)": { es: "Esperado XXX_Y.JPG (ej. P001BLK_F.JPG, P001BLK_D1.JPG)", zh: "期望格式 XXX_Y.JPG（如 P001BLK_F.JPG、P001BLK_D1.JPG）" },
  "Codes: F (front), B (back), D1/D2… (detail), MF, MB, MX1/MX2… (model), S1/S2… (shein)": { es: "Códigos: F (frente), B (espalda), D1/D2… (detalle), MF, MB, MX1/MX2… (modelo), S1/S2… (shein)", zh: "代码：F（正面）、B（背面）、D1/D2…（细节）、MF、MB、MX1/MX2…（模特）、S1/S2…（SHEIN）" },

  "Company information": { es: "Información de empresa", zh: "公司信息" },
  "Company information saved": { es: "Información de empresa guardada", zh: "公司信息已保存" },
  "Company name": { es: "Nombre de empresa", zh: "公司名称" },
  "Company name and VAT/CIF are required.": { es: "El nombre de empresa y el IVA/CIF son obligatorios.", zh: "公司名称和 VAT/CIF 为必填项。" },
  "Confirm company information changes?": { es: "¿Confirmar cambios de empresa?", zh: "确认修改公司信息？" },
  "Update company details and payment information.": { es: "Actualizar datos de empresa e información de pago.", zh: "更新公司资料和付款信息。" },
  "Beneficiary": { es: "Beneficiario", zh: "收款人" },
  "Bank / IBAN": { es: "Banco / IBAN", zh: "银行 / IBAN" },
  "Swift": { es: "SWIFT", zh: "SWIFT" },
  "Document numbering": { es: "Numeración de documentos", zh: "单据编号" },
  "Letters": { es: "Letras", zh: "字母" },
  "Next": { es: "Siguiente", zh: "下一个" },
  "Invalid serial": { es: "Serie no válida", zh: "编号无效" },
  "Serial settings saved": { es: "Ajustes de serie guardados", zh: "编号设置已保存" },
  "Confirm serial changes?": { es: "¿Confirmar cambios de numeración?", zh: "确认修改编号？" },
  "The next document of each type will use the values shown.": { es: "El siguiente documento de cada tipo usará los valores mostrados.", zh: "每类单据的下一张将使用显示的数值。" },
  "Ribbon title": { es: "Título superior", zh: "顶部标题" },
  "Title shown centered on the top ribbon": { es: "Título centrado en la barra superior", zh: "显示在顶部中间的标题" },
  "Title required": { es: "Título obligatorio", zh: "标题为必填项" },
  "Ribbon title cannot be empty.": { es: "El título no puede estar vacío.", zh: "顶部标题不能为空。" },
  "Ribbon title updated": { es: "Título actualizado", zh: "顶部标题已更新" },
  "Confirm ribbon title change?": { es: "¿Confirmar cambio de título?", zh: "确认修改顶部标题？" },
  "B2B default (%)": { es: "B2B por defecto (%)", zh: "B2B 默认 (%)" },
  "B2C default (%)": { es: "B2C por defecto (%)", zh: "B2C 默认 (%)" },
  "Per-customer rates (B2B)": { es: "Tipos por cliente (B2B)", zh: "按客户设置税率（B2B）" },
  "Default rates by business type": { es: "Tipos por defecto según empresa", zh: "按企业类型的默认税率" },
  "Business": { es: "Empresa", zh: "企业" },
  "Default": { es: "Por defecto", zh: "默认" },
  "% (editable).": { es: "% (editable).", zh: "%（可编辑）。" },
  "Invalid rates": { es: "Tipos no válidos", zh: "税率无效" },
  "Tax rates must be between 0 and 100.": { es: "Los tipos impositivos deben estar entre 0 y 100.", zh: "税率必须在 0 到 100 之间。" },
  "Tax settings saved": { es: "Ajustes fiscales guardados", zh: "税务设置已保存" },
  "Confirm tax changes?": { es: "¿Confirmar cambios fiscales?", zh: "确认修改税务设置？" },
  "No B2B customers yet.": { es: "Todavía no hay clientes B2B.", zh: "还没有 B2B 客户。" },
  "Leave empty to use the B2B default. Custom values override the default for that customer.": { es: "Déjalo vacío para usar el valor B2B por defecto. Los valores personalizados tienen prioridad para ese cliente.", zh: "留空则使用 B2B 默认值。自定义值会覆盖该客户的默认税率。" },
  "Applied automatically to B2B customers based on their business type. Per-customer overrides below take priority.": { es: "Se aplica automáticamente a clientes B2B según su tipo de empresa. Los ajustes por cliente tienen prioridad.", zh: "根据企业类型自动应用到 B2B 客户。下方按客户设置的值优先。" },
  "Colour table": { es: "Tabla de colores", zh: "颜色表" },
  "Used in product variations. Codes are auto-generated (max 3 characters) and must be unique.": { es: "Usado en variaciones de producto. Los códigos se generan automáticamente (máx. 3 caracteres) y deben ser únicos.", zh: "用于产品变体。代码会自动生成（最多 3 个字符），且必须唯一。" },
  "New colour name (e.g. CHARCOAL)": { es: "Nuevo color (ej. CHARCOAL)", zh: "新颜色名称（如 CHARCOAL）" },
  "Name required": { es: "Nombre obligatorio", zh: "名称为必填项" },
  "Enter a colour name.": { es: "Introduce un nombre de color.", zh: "请输入颜色名称。" },
  "Duplicate": { es: "Duplicado", zh: "重复" },
  "Colour already exists.": { es: "El color ya existe.", zh: "颜色已存在。" },
  "Could not generate code": { es: "No se pudo generar el código", zh: "无法生成代码" },
  "Try a different name.": { es: "Prueba con otro nombre.", zh: "请换一个名称。" },
  "Colour added": { es: "Color añadido", zh: "颜色已添加" },
  "Awaiting approval": { es: "Pendiente de aprobación", zh: "等待审批" },
  "Awaiting developer approval": { es: "Pendiente de aprobación del desarrollador", zh: "等待开发者审批" },
  "Awaiting developer approval.": { es: "Pendiente de aprobación del desarrollador.", zh: "等待开发者审批。" },
  "Approval request submitted": { es: "Solicitud de aprobación enviada", zh: "审批请求已提交" },
  "Already pending": { es: "Ya pendiente", zh: "已在等待中" },
  "A deletion request is already awaiting approval.": { es: "Ya hay una solicitud de eliminación pendiente.", zh: "已有一个删除请求在等待审批。" },

  "Transport settings": { es: "Ajustes de transporte", zh: "运输设置" },
  "Pickup origin": { es: "Origen de recogida", zh: "自取地址" },
  "Shipping calculator": { es: "Calculadora de envío", zh: "运费计算器" },
  "Destination country": { es: "País de destino", zh: "目的地国家" },
  "Weight (kg)": { es: "Peso (kg)", zh: "重量（kg）" },
  "Enter a weight greater than 0 kg.": { es: "Introduce un peso mayor que 0 kg.", zh: "请输入大于 0 kg 的重量。" },
  "No SEUR tariff available for this destination — the default fallback fee will apply in POS.": { es: "No hay tarifa SEUR para este destino; se aplicará la tarifa por defecto en TPV.", zh: "此目的地暂无 SEUR 运价，收银台将使用默认备用运费。" },
  "No SEUR tariff available for this destination 鈥?the default fallback fee will apply in POS.": { es: "No hay tarifa SEUR para este destino; se aplicará la tarifa por defecto en TPV.", zh: "此目的地暂无 SEUR 运价，收银台将使用默认备用运费。" },

  "Operational log": { es: "Registro operativo", zh: "操作日志" },
  "No activity yet": { es: "Todavía no hay actividad", zh: "暂无活动" },
  "Changes to products, customers, sales and accounts will appear here.": { es: "Aquí aparecerán los cambios de productos, clientes, ventas y cuentas.", zh: "产品、客户、销售和账号变更会显示在这里。" },
  "Clear log": { es: "Limpiar registro", zh: "清空日志" },
  "Clear history": { es: "Limpiar historial", zh: "清空历史" },
  "Clear the entire operational log? This cannot be undone.": { es: "¿Limpiar todo el registro operativo? Esta acción no se puede deshacer.", zh: "清空全部操作日志？此操作无法撤销。" },
  "Log cleared": { es: "Registro limpiado", zh: "日志已清空" },
  "No pending requests": { es: "No hay solicitudes pendientes", zh: "没有待审批请求" },
  "Operator-restricted actions will appear here for approval.": { es: "Las acciones restringidas de operador aparecerán aquí para aprobación.", zh: "操作员受限操作会显示在这里等待审批。" },
  "Approved & executed": { es: "Aprobado y ejecutado", zh: "已批准并执行" },
  "Decline request": { es: "Rechazar solicitud", zh: "拒绝请求" },
  "Confirm decline": { es: "Confirmar rechazo", zh: "确认拒绝" },

  "Oops! Page not found": { es: "¡Vaya! Página no encontrada", zh: "抱歉，页面未找到" },
  "Return to Home": { es: "Volver al inicio", zh: "返回首页" },
};

type PatternTranslation = {
  pattern: RegExp;
  es: (match: RegExpMatchArray) => string;
  zh: (match: RegExpMatchArray) => string;
};

const PATTERNS: PatternTranslation[] = [
  {
    pattern: /^Uploaded (\d+) picture(s)?$/,
    es: (m) => `${m[1]} imagen${m[1] === "1" ? "" : "es"} subida${m[1] === "1" ? "" : "s"}`,
    zh: (m) => `已上传 ${m[1]} 张图片`,
  },
  {
    pattern: /^Uploaded (\d+), rejected (\d+) \(wrong name format\)$/,
    es: (m) => `Subidas ${m[1]}, rechazadas ${m[2]} (formato de nombre incorrecto)`,
    zh: (m) => `已上传 ${m[1]} 个，拒绝 ${m[2]} 个（文件名格式错误）`,
  },
  {
    pattern: /^Rejected (\d+) file(s)? - wrong name format$/,
    es: (m) => `${m[1]} archivo${m[1] === "1" ? "" : "s"} rechazado${m[1] === "1" ? "" : "s"} - formato de nombre incorrecto`,
    zh: (m) => `已拒绝 ${m[1]} 个文件 - 文件名格式错误`,
  },
  {
    pattern: /^(Document|Tax|Transport|VAT|Recargo|Selling to) ·$/,
    es: (m) => `${translateText(m[1], "es")} ·`,
    zh: (m) => `${translateText(m[1], "zh")} ·`,
  },
  {
    pattern: /^(Document|Tax|Transport|VAT|Recargo|Selling to) · (.+)$/,
    es: (m) => `${translateText(m[1], "es")} · ${translateText(m[2], "es")}`,
    zh: (m) => `${translateText(m[1], "zh")} · ${translateText(m[2], "zh")}`,
  },
  {
    pattern: /^Signed in as (.+)$/,
    es: (m) => `Sesión iniciada como ${m[1]}`,
    zh: (m) => `已登录为 ${m[1]}`,
  },
  {
    pattern: /^You are signed in as (.+) \((.+)\)\.$/,
    es: (m) => `Has iniciado sesión como ${m[1]} (${translateText(m[2], "es")}).`,
    zh: (m) => `当前登录账号：${m[1]}（${translateText(m[2], "zh")}）。`,
  },
  {
    pattern: /^Language is already set to (.+)$/,
    es: (m) => `El idioma ya está configurado como ${m[1]}`,
    zh: (m) => `语言已经是 ${m[1]}`,
  },
  {
    pattern: /^Now set to (.+)$/,
    es: (m) => `Ahora está configurado como ${m[1]}`,
    zh: (m) => `当前已设置为 ${m[1]}`,
  },
  {
    pattern: /^Password updated for (.+)$/,
    es: (m) => `Contraseña actualizada para ${m[1]}`,
    zh: (m) => `${m[1]} 的密码已更新`,
  },
  {
    pattern: /^Operator "(.+)" created$/,
    es: (m) => `Operador "${m[1]}" creado`,
    zh: (m) => `操作员“${m[1]}”已创建`,
  },
  {
    pattern: /^Delete operator "(.+)"\? They will no longer be able to sign in\.$/,
    es: (m) => `¿Eliminar operador "${m[1]}"? Ya no podrá iniciar sesión.`,
    zh: (m) => `删除操作员“${m[1]}”？该账号将无法再登录。`,
  },
  {
    pattern: /^Removed "(.+)"$/,
    es: (m) => `"${m[1]}" eliminado`,
    zh: (m) => `已移除“${m[1]}”`,
  },
  {
    pattern: /^No product for "(.+)"$/,
    es: (m) => `No hay producto para "${m[1]}"`,
    zh: (m) => `未找到“${m[1]}”对应的产品`,
  },
  {
    pattern: /^"(.+)" is a model code\. Enter the full SKU \(Model \+ Colour \+ Size\)\.$/,
    es: (m) => `"${m[1]}" es un código de modelo. Introduce el SKU completo (Modelo + Color + Talla).`,
    zh: (m) => `“${m[1]}”是型号代码。请输入完整 SKU（型号 + 颜色 + 尺码）。`,
  },
  {
    pattern: /^Added . (.+)$/,
    es: (m) => `Añadido · ${m[1]}`,
    zh: (m) => `已添加 · ${m[1]}`,
  },
  {
    pattern: /^Generated (\d+) variation(s)?$/,
    es: (m) => `Generadas ${m[1]} variaciones`,
    zh: (m) => `已生成 ${m[1]} 个变体`,
  },
  {
    pattern: /^Complete every field on Variation #(\d+)$/,
    es: (m) => `Completa todos los campos de la variación #${m[1]}`,
    zh: (m) => `请补完整第 ${m[1]} 个变体的所有字段`,
  },
  {
    pattern: /^Composition must add up to 100% \(currently (.+)%\)$/,
    es: (m) => `La composición debe sumar 100% (actualmente ${m[1]}%)`,
    zh: (m) => `成分总和必须为 100%（当前 ${m[1]}%）`,
  },
  {
    pattern: /^Model "(.+)" already exists\. Choose a different code\.$/,
    es: (m) => `El modelo "${m[1]}" ya existe. Elige otro código.`,
    zh: (m) => `型号“${m[1]}”已存在。请选择其他代码。`,
  },
  {
    pattern: /^Select (B2B|B2C) customer$/,
    es: (m) => `Seleccionar cliente ${m[1]}`,
    zh: (m) => `选择 ${m[1]} 客户`,
  },
  {
    pattern: /^(\d+) selected$/,
    es: (m) => `${m[1]} seleccionados`,
    zh: (m) => `已选 ${m[1]} 个`,
  },
  {
    pattern: /^(\d+) customer(s)? updated\.$/,
    es: (m) => `${m[1]} clientes actualizados.`,
    zh: (m) => `已更新 ${m[1]} 个客户。`,
  },
  {
    pattern: /^(.+) settings$/,
    es: (m) => `Ajustes de ${translateText(m[1], "es").toLowerCase()}`,
    zh: (m) => `${translateText(m[1], "zh")}设置`,
  },
];

const ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"] as const;
type LocalizedAttribute = (typeof ATTRIBUTES)[number];

const textSources = new WeakMap<Text, string>();
const textRendered = new WeakMap<Text, string>();
const attrSources = new WeakMap<Element, Partial<Record<LocalizedAttribute, string>>>();
const attrRendered = new WeakMap<Element, Partial<Record<LocalizedAttribute, string>>>();

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function normalizeText(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function interpolate(text: string, params?: Record<string, string | number>) {
  if (!params) return text;
  return Object.entries(params).reduce(
    (value, [key, replacement]) => value.replace(new RegExp(`\\{${key}\\}`, "g"), String(replacement)),
    text,
  );
}

function preserveWhitespace(source: string, replacement: string) {
  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  return `${leading}${replacement}${trailing}`;
}

function readStoredLanguage(): Language {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return stored === "es" || stored === "zh" || stored === "en" ? stored : "en";
}

export function getLanguageLabel(language: Language) {
  return LANGUAGES.find((item) => item.code === language)?.label ?? "English";
}

export function translateText(text: string, language: Language, params?: Record<string, string | number>) {
  const prepared = interpolate(text, params);
  if (language === "en") return prepared;

  const normalized = normalizeText(prepared);
  const exact = TEXT[normalized]?.[language];
  if (exact) return preserveWhitespace(prepared, exact);

  for (const item of PATTERNS) {
    const match = normalized.match(item.pattern);
    if (match) {
      return preserveWhitespace(prepared, item[language](match));
    }
  }

  return prepared;
}

function shouldSkipElement(element: Element | null) {
  if (!element) return false;
  return Boolean(element.closest("[data-i18n-skip='true'], script, style, code, pre"));
}

function syncTextNode(node: Text, language: Language) {
  const current = node.nodeValue ?? "";
  if (!normalizeText(current)) return;
  if (shouldSkipElement(node.parentElement)) return;

  const previousRendered = textRendered.get(node);
  let source = textSources.get(node);
  if (!source || current !== previousRendered) {
    source = current;
    textSources.set(node, source);
  }

  const next = translateText(source, language);
  if (current !== next) {
    node.nodeValue = next;
  }
  textRendered.set(node, next);
}

function syncAttributes(element: Element, language: Language) {
  if (shouldSkipElement(element)) return;
  let sources = attrSources.get(element);
  let rendered = attrRendered.get(element);
  if (!sources) {
    sources = {};
    attrSources.set(element, sources);
  }
  if (!rendered) {
    rendered = {};
    attrRendered.set(element, rendered);
  }

  ATTRIBUTES.forEach((attribute) => {
    const current = element.getAttribute(attribute);
    if (!current || !normalizeText(current)) return;
    if (!sources[attribute] || current !== rendered[attribute]) {
      sources[attribute] = current;
    }
    const source = sources[attribute];
    if (!source) return;
    const next = translateText(source, language);
    if (current !== next) {
      element.setAttribute(attribute, next);
    }
    rendered[attribute] = next;
  });
}

function localizeDocument(language: Language) {
  if (typeof document === "undefined" || !document.body) return;

  const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let textNode = textWalker.nextNode();
  while (textNode) {
    syncTextNode(textNode as Text, language);
    textNode = textWalker.nextNode();
  }

  syncAttributes(document.body, language);
  document.body.querySelectorAll("*").forEach((element) => syncAttributes(element, language));
}

function RuntimeLocalizer({ language }: { language: Language }) {
  useLayoutEffect(() => {
    if (typeof document === "undefined" || !document.body) return;

    let scheduled = false;
    const run = () => {
      scheduled = false;
      localizeDocument(language);
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(run);
    };

    run();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES],
    });

    return () => observer.disconnect();
  }, [language]);

  return null;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => readStoredLanguage());

  const setLanguage = (nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
  };

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : language;
  }, [language]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: (text, params) => translateText(text, language, params),
    }),
    [language],
  );

  return (
    <I18nContext.Provider value={value}>
      {children}
      <RuntimeLocalizer language={language} />
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return value;
}
