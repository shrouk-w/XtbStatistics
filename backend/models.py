from sqlalchemy import Column, Integer, String, Float, DateTime, BigInteger
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class CashOperation(Base):
    __tablename__ = 'cash_operations'
    id = Column(Integer, primary_key=True)
    external_id = Column(BigInteger, unique=True)
    operation_type = Column(String)
    time = Column(DateTime)
    comment = Column(String)
    symbol = Column(String)
    amount = Column(Float)

class ClosedPosition(Base):
    __tablename__ = 'closed_positions'
    id = Column(Integer, primary_key=True)
    position_id = Column(BigInteger, unique=True)
    symbol = Column(String)
    type = Column(String)
    volume = Column(Float)
    open_time = Column(DateTime)
    open_price = Column(Float)
    close_time = Column(DateTime)
    close_price = Column(Float)
    purchase_value = Column(Float)
    sale_value = Column(Float)
    sl = Column(Float)
    tp = Column(Float)
    margin = Column(Float)
    commission = Column(Float)
    swap = Column(Float)
    rollover = Column(Float)
    gross_pl = Column(Float)
    comment = Column(String)

class OpenPosition(Base):
    __tablename__ = 'open_positions'
    id = Column(Integer, primary_key=True)
    position_id = Column(BigInteger, unique=True)
    symbol = Column(String)
    type = Column(String)
    volume = Column(Float)
    open_time = Column(DateTime)
    open_price = Column(Float)
    market_price = Column(Float)
    purchase_value = Column(Float)
    sl = Column(Float)
    tp = Column(Float)
    margin = Column(Float)
    commission = Column(Float)
    swap = Column(Float)
    rollover = Column(Float)
    gross_pl = Column(Float)
    comment = Column(String)

class PendingOrder(Base):
    __tablename__ = 'pending_orders'
    id = Column(Integer, primary_key=True)
    order_id = Column(BigInteger, unique=True)
    symbol = Column(String)
    purchase_value = Column(Float)
    nominal_value = Column(Float)
    price = Column(Float)
    margin = Column(Float)
    type = Column(String)
    order_type = Column(String)
    side = Column(String)
    sl = Column(Float)
    tp = Column(Float)
    open_time = Column(DateTime)
