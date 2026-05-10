import sys
import os
import pandas as pd
from sqlalchemy.orm import Session
from datetime import datetime

# Add the parent directory to sys.path to allow importing from backend
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.database import SessionLocal, init_db
from backend.models import CashOperation, ClosedPosition, OpenPosition, PendingOrder

def clean_df(df, id_col='ID'):
    # Remove columns that are fully NaN or Unnamed with no data
    df = df.loc[:, ~df.columns.str.contains('^Unnamed')]
    # Drop rows that are fully NaN
    df = df.dropna(how='all')
    # Drop rows where id_col is not a number (like 'Total' row)
    if id_col in df.columns:
        df = df[pd.to_numeric(df[id_col], errors='coerce').notnull()]
        # Drop duplicates by id_col
        df = df.drop_duplicates(subset=[id_col])
    return df

def import_excel(file_path):
    print(f"Importing data from {file_path}...")
    xl = pd.ExcelFile(file_path)
    db: Session = SessionLocal()
    
    try:
        # 1. Cash Operations
        print("Processing Cash Operations...")
        df_cash = pd.read_excel(xl, sheet_name='CASH OPERATION HISTORY', header=8)
        df_cash = clean_df(df_cash, 'ID')
        for _, row in df_cash.iterrows():
            external_id = int(row['ID'])
            existing = db.query(CashOperation).filter(CashOperation.external_id == external_id).first()
            if existing:
                existing.operation_type = row['Type']
                existing.time = pd.to_datetime(row['Time'])
                existing.comment = str(row.get('Comment')) if pd.notnull(row.get('Comment')) else None
                existing.symbol = str(row.get('Symbol')) if pd.notnull(row.get('Symbol')) else None
                existing.amount = row['Amount']
            else:
                op = CashOperation(
                    external_id=external_id,
                    operation_type=row['Type'],
                    time=pd.to_datetime(row['Time']),
                    comment=str(row.get('Comment')) if pd.notnull(row.get('Comment')) else None,
                    symbol=str(row.get('Symbol')) if pd.notnull(row.get('Symbol')) else None,
                    amount=row['Amount']
                )
                db.add(op)
        
        # 2. Closed Positions
        print("Processing Closed Positions...")
        closed_sheet = next((s for s in xl.sheet_names if 'CLOSED POSITION' in s.upper()), None)
        if closed_sheet:
            df_closed = pd.read_excel(xl, sheet_name=closed_sheet, header=10)
            df_closed = clean_df(df_closed, 'Position')
            for _, row in df_closed.iterrows():
                pos_id = int(row['Position'])
                existing = db.query(ClosedPosition).filter(ClosedPosition.position_id == pos_id).first()
                data = dict(
                    symbol=row['Symbol'],
                    type=row['Type'],
                    volume=row['Volume'],
                    open_time=pd.to_datetime(row['Open time']),
                    open_price=row['Open price'],
                    close_time=pd.to_datetime(row['Close time']),
                    close_price=row['Close price'],
                    purchase_value=row['Purchase value'],
                    sale_value=row['Sale value'],
                    sl=row['SL'],
                    tp=row['TP'],
                    margin=row['Margin'],
                    commission=row['Commission'],
                    swap=row['Swap'],
                    rollover=row['Rollover'],
                    gross_pl=row['Gross P/L'],
                    comment=str(row.get('Comment')) if pd.notnull(row.get('Comment')) else None
                )
                if existing:
                    for k, v in data.items(): setattr(existing, k, v)
                else:
                    db.add(ClosedPosition(position_id=pos_id, **data))

        # 3. Open Positions
        print("Processing Open Positions...")
        db.query(OpenPosition).delete()
        open_sheet = next((s for s in xl.sheet_names if 'OPEN POSITION' in s.upper()), None)
        if open_sheet:
            df_open = pd.read_excel(xl, sheet_name=open_sheet, header=8)
            df_open = clean_df(df_open, 'Position')
            for _, row in df_open.iterrows():
                pos = OpenPosition(
                    position_id=row['Position'],
                    symbol=row['Symbol'],
                    type=row['Type'],
                    volume=row['Volume'],
                    open_time=pd.to_datetime(row['Open time']),
                    open_price=row['Open price'],
                    market_price=row['Market price'],
                    purchase_value=row['Purchase value'],
                    sl=row['SL'],
                    tp=row['TP'],
                    margin=row['Margin'],
                    commission=row['Commission'],
                    swap=row['Swap'],
                    rollover=row['Rollover'],
                    gross_pl=row['Gross P/L'],
                    comment=str(row.get('Comment')) if pd.notnull(row.get('Comment')) else None
                )
                db.add(pos)

        # 4. Pending Orders
        print("Processing Pending Orders...")
        db.query(PendingOrder).delete()
        pending_sheet = next((s for s in xl.sheet_names if 'PENDING ORDERS' in s.upper()), None)
        if pending_sheet:
            df_pending = pd.read_excel(xl, sheet_name=pending_sheet, header=8)
            df_pending = clean_df(df_pending, 'ID')
            for _, row in df_pending.iterrows():
                order = PendingOrder(
                    order_id=row['ID'],
                    symbol=row['Symbol'],
                    purchase_value=row['Purchase value'],
                    nominal_value=row['Nominal Value'],
                    price=row['Price'],
                    margin=row['Margin'],
                    type=row['Type'],
                    order_type=row['Order'],
                    side=row['side'],
                    sl=row['SL'],
                    tp=row['TP'],
                    open_time=pd.to_datetime(row['Open time'])
                )
                db.add(order)

        db.commit()
        print("Import completed successfully.")
    except Exception as e:
        db.rollback()
        print(f"Error during import: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python import_excel.py <path_to_excel>")
    else:
        init_db()
        import_excel(sys.argv[1])
