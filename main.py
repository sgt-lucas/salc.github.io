import os
import io
import re
from datetime import date, datetime
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, status, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator, Field
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, ForeignKey, DateTime
from sqlalchemy.orm import sessionmaker, Session, relationship
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.exc import IntegrityError
import pandas as pd
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet

# --- Configuração do Banco de Dados para Produção ---
# A URL de conexão será lida da variável de ambiente no servidor de hospedagem.
DATABASE_URL = os.getenv("DATABASE_URL")

# Validação para garantir que a variável de ambiente foi configurada
if DATABASE_URL is None:
    print("Aviso: Variável de ambiente DATABASE_URL não encontrada. Usando SQLite local como fallback.")
    DATABASE_URL = "sqlite:///./notascredito.db"

# Ajuste para compatibilidade com o Heroku/Render que usa 'postgres://' 
# enquanto SQLAlchemy prefere 'postgresql://'
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- Modelos do Banco de Dados (SQLAlchemy) - Sem alterações ---
class Nota(Base):
    __tablename__ = "notas"
    numero = Column(String, primary_key=True, index=True)
    valor = Column(Float, nullable=False)
    valor_restante = Column(Float, nullable=False)
    descricao = Column(String)
    observacao = Column(String)
    prazo = Column(Date, nullable=False)
    natureza_despesa_codigo = Column(String(8), nullable=False)
    plano_interno_codigo = Column(String, nullable=False)
    ptres_codigo = Column(String(6), nullable=False)
    fonte_codigo = Column(String(10), nullable=False)
    data_criacao = Column(DateTime, default=datetime.utcnow)
    
    empenhos = relationship("Empenho", back_populates="nota", cascade="all, delete-orphan")
    recolhimentos = relationship("Recolhimento", back_populates="nota", cascade="all, delete-orphan")

class Empenho(Base):
    __tablename__ = "empenhos"
    id = Column(Integer, primary_key=True, autoincrement=True)
    numero = Column(String, index=True, unique=True, nullable=False)
    numero_nota = Column(String, ForeignKey('notas.numero', ondelete='CASCADE'), index=True, nullable=False)
    valor = Column(Float, nullable=False)
    descricao = Column(String)
    data = Column(Date, nullable=False)
    secao_requisitante_codigo = Column(String)
    
    nota = relationship("Nota", back_populates="empenhos")

class Recolhimento(Base):
    __tablename__ = "recolhimentos"
    id = Column(Integer, primary_key=True, autoincrement=True)
    numero = Column(String, index=True, unique=True, nullable=False)
    numero_nota = Column(String, ForeignKey('notas.numero', ondelete='CASCADE'), index=True, nullable=False)
    valor = Column(Float, nullable=False)
    descricao = Column(String)
    data = Column(Date, nullable=False)

    nota = relationship("Nota", back_populates="recolhimentos")

# --- Modelos Pydantic - Sem alterações ---
class NotaSchema(BaseModel):
    numero: str
    valor: float = Field(..., gt=0)
    descricao: Optional[str] = None
    observacao: Optional[str] = None
    prazo: date
    natureza_despesa_codigo: str
    plano_interno_codigo: str
    ptres_codigo: str
    fonte_codigo: str

    @validator('natureza_despesa_codigo')
    def validate_nd(cls, v):
        if not re.match(r'^\d{8}$', v):
            raise ValueError('Natureza da Despesa deve conter 8 dígitos.')
        return v
    
    @validator('ptres_codigo')
    def validate_ptres(cls, v):
        if not re.match(r'^\d{6}$', v):
            raise ValueError('PTRES deve conter 6 dígitos.')
        return v

    class Config:
        orm_mode = True

class EmpenhoSchema(BaseModel):
    numero: str
    numero_nota: str
    valor: float = Field(..., gt=0)
    descricao: Optional[str] = None
    data: date
    secao_requisitante_codigo: Optional[str] = None

    class Config:
        orm_mode = True

class RecolhimentoSchema(BaseModel):
    numero: str
    numero_nota: str
    valor: float = Field(..., gt=0)
    descricao: Optional[str] = None
    data: date
    
    class Config:
        orm_mode = True

# --- Aplicação FastAPI ---
app = FastAPI(title="Gestão de Notas de Crédito", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)

# --- Rotas da API (Endpoints) - Sem alterações na lógica ---

@app.get("/", include_in_schema=False)
def root():
    return {"message": "API de Gestão de Notas de Crédito no ar."}

@app.get("/notas", response_model=List[NotaSchema])
def read_notas(db: Session = Depends(get_db), numero: Optional[str] = None, data_inicio: Optional[date] = None, data_fim: Optional[date] = None):
    query = db.query(Nota)
    if numero:
        query = query.filter(Nota.numero.contains(numero))
    if data_inicio:
        query = query.filter(Nota.prazo >= data_inicio)
    if data_fim:
        query = query.filter(Nota.prazo <= data_fim)
    return query.order_by(Nota.data_criacao.desc()).all()

@app.post("/notas", response_model=NotaSchema, status_code=status.HTTP_201_CREATED)
def create_nota(nota: NotaSchema, db: Session = Depends(get_db)):
    db_nota = Nota(**nota.dict(), valor_restante=nota.valor)
    try:
        db.add(db_nota)
        db.commit()
        db.refresh(db_nota)
        return db_nota
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Número da nota de crédito já existe.")

@app.delete("/notas/{numero}", status_code=status.HTTP_204_NO_CONTENT)
def delete_nota(numero: str, db: Session = Depends(get_db)):
    nota = db.query(Nota).filter(Nota.numero == numero).first()
    if not nota:
        raise HTTPException(status_code=404, detail="Nota de crédito não encontrada.")
    if nota.empenhos or nota.recolhimentos:
        raise HTTPException(status_code=400, detail="Não é possível excluir: existem empenhos ou recolhimentos associados.")
    db.delete(nota)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@app.get("/empenhos", response_model=List[EmpenhoSchema])
def read_empenhos(db: Session = Depends(get_db)):
    return db.query(Empenho).order_by(Empenho.data.desc()).all()

@app.post("/empenhos", status_code=status.HTTP_201_CREATED)
def create_empenho(empenho: EmpenhoSchema, db: Session = Depends(get_db)):
    try:
        with db.begin_nested():
            nota = db.query(Nota).filter(Nota.numero == empenho.numero_nota).with_for_update().first()
            if not nota:
                raise HTTPException(status_code=404, detail="Nota de crédito não encontrada.")
            if empenho.valor > nota.valor_restante:
                raise HTTPException(status_code=400, detail="Valor do empenho excede o saldo da nota.")
            nota.valor_restante -= empenho.valor
            db_empenho = Empenho(**empenho.dict())
            db.add(db_empenho)
        db.commit()
        return {"message": "Empenho criado com sucesso."}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Número de empenho já existe.")
    except Exception as e:
        db.rollback()
        raise e

@app.delete("/empenhos/{numero}", status_code=status.HTTP_204_NO_CONTENT)
def delete_empenho(numero: str, db: Session = Depends(get_db)):
    try:
        with db.begin_nested():
            empenho = db.query(Empenho).filter(Empenho.numero == numero).first()
            if not empenho:
                raise HTTPException(status_code=404, detail="Empenho não encontrado.")
            nota = db.query(Nota).filter(Nota.numero == empenho.numero_nota).with_for_update().first()
            if nota:
                nota.valor_restante += empenho.valor
            db.delete(empenho)
        db.commit()
    except Exception as e:
        db.rollback()
        raise e
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# (As rotas de Recolhimentos e Relatórios podem ser mantidas como estavam)